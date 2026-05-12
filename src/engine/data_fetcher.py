import contextlib
import io
import json
import os
import re
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path


GROQ_MODEL = "llama-3.1-8b-instant"
MARKET_SCHEMA_KEYS = (
    "petrol_price_mwk",
    "diesel_price_mwk",
    "kerosene_price_mwk",
    "usd_mwk_rate",
    "supply_alert",
    "market_note",
    "fetched_at",
)
SEARCH_QUERIES = (
    "fuel prices Malawi petrol diesel kerosene MWK per litre 2025",
    "NOCMA fuel supply Malawi shortage update",
    "USD MWK exchange rate today",
)
FALLBACK_SEARCH_QUERIES = {
    "fuel prices Malawi petrol diesel kerosene MWK per litre 2025": (
        "Malawi fuel prices",
        "Malawi gasoline price",
    ),
    "NOCMA fuel supply Malawi shortage update": (
        "Malawi fuel supply NOCMA",
        "Malawi fuel shortage",
    ),
    "USD MWK exchange rate today": (
        "USD MWK",
        "1 USD to MWK",
    ),
}
TRUSTED_FUEL_NEWS_SOURCES = (
    {
        "source": "Malawi Nyasa Times",
        "source_type": "local_news",
        "reliability": "news_report",
        "queries": (
            'site:facebook.com "Nyasa Times" Malawi fuel',
            'site:facebook.com "Malawi Nyasa Times" petrol OR diesel',
            'site:nyasatimes.com Malawi fuel',
        ),
    },
    {
        "source": "Times 360",
        "source_type": "local_news",
        "reliability": "news_report",
        "queries": (
            'site:facebook.com "Times 360" Malawi fuel',
            'site:facebook.com "Times 360 Malawi" petrol OR diesel',
            'site:times.mw Malawi fuel',
        ),
    },
    {
        "source": "Malawi Energy Regulatory Authority",
        "source_type": "official",
        "reliability": "official",
        "queries": (
            "MERA Malawi fuel prices petrol diesel paraffin",
            "Malawi Energy Regulatory Authority fuel prices",
        ),
    },
    {
        "source": "NOCMA",
        "source_type": "official",
        "reliability": "official",
        "queries": (
            "NOCMA Malawi fuel supply shortage",
            "National Oil Company of Malawi fuel supply",
        ),
    },
    {
        "source": "Other Malawi news broadcasters",
        "source_type": "local_news",
        "reliability": "news_report",
        "queries": (
            'site:facebook.com "Zodiak Online" Malawi fuel',
            'site:facebook.com "MBC Online" Malawi fuel',
            'site:facebook.com "Nation Publications" Malawi fuel',
            "Malawi fuel shortage news petrol diesel",
        ),
    },
)
FUEL_VALUE_RANGE = (500, 10000)
USD_MWK_VALUE_RANGE = (500, 5000)
DEFAULT_MARKET_SEARCH_BUDGET_SECONDS = 12
DEFAULT_DUCKDUCKGO_TIMEOUT_SECONDS = 3
DEFAULT_GROQ_TIMEOUT_SECONDS = 10
MAX_MARKET_RECORDS = 10
MAX_NEWS_SEARCHES = 5
MAX_MARKET_CONTEXT_CHARS = 12000
FUEL_RE = re.compile(
    r"\b(fuel|petrol|diesel|kerosene|paraffin|gasoline|gasoil|pump|tanker|stockout|stock-out|shortage|resupply|supply)\b",
    re.IGNORECASE,
)
MALAWI_RE = re.compile(r"\b(malawi|malawian|mwk|kwacha|mera|nocma|lilongwe|blantyre|mzuzu)\b", re.IGNORECASE)

warnings.filterwarnings("ignore", message=".*duckduckgo_search.*")


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _log_error(message):
    print(f"[{_utc_now_iso()}] ERROR {message}", file=sys.stderr)


def _env_float(name, default):
    try:
        value = float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)
    return max(0.0, value)


def _env_int(name, default):
    try:
        value = int(os.getenv(name, default))
    except (TypeError, ValueError):
        return int(default)
    return max(0, value)


def _seconds_remaining(deadline):
    return max(0.0, deadline - time.monotonic())


def _has_time(deadline, minimum=0.25):
    return _seconds_remaining(deadline) > minimum


def _load_environment():
    try:
        from dotenv import load_dotenv
    except Exception as exc:
        _log_error(f"python-dotenv unavailable: {exc}")
        return

    try:
        load_dotenv()
        repo_env = Path(__file__).resolve().parents[2] / ".env"
        if repo_env.exists():
            load_dotenv(dotenv_path=repo_env, override=False)
    except Exception as exc:
        _log_error(f"Failed to load .env: {exc}")


def _safe_market_data(note):
    return {
        "petrol_price_mwk": None,
        "diesel_price_mwk": None,
        "kerosene_price_mwk": None,
        "usd_mwk_rate": None,
        "supply_alert": None,
        "market_note": note,
        "fetched_at": _utc_now_iso(),
        "sources": [],
    }


def _strip_markdown_fences(content):
    value = str(content or "").strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    return value.strip()


def _json_from_content(content):
    cleaned = _strip_markdown_fences(content)
    if not cleaned.startswith("{"):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def _number_or_none(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", value)
        if match:
            try:
                return float(match.group(0).replace(",", ""))
            except ValueError:
                return None
    return None


def _sentence_chunks(text):
    cleaned = re.sub(r"\s+", " ", str(text or " ")).strip()
    return [chunk.strip() for chunk in re.split(r"(?<=[.!?])\s+|\n+", cleaned) if chunk.strip()]


def _numbers_in_range(text, minimum, maximum):
    candidates = []
    for match in re.finditer(r"(?<![A-Za-z])(?:MWK|MK|K)?\s*([0-9][0-9,]*(?:\.\d+)?)", text, re.IGNORECASE):
        number = _number_or_none(match.group(1))
        if number is not None and minimum <= number <= maximum:
            candidates.append((number, match.start(), match.end()))
    return candidates


def _has_price_unit_nearby(chunk, start, end):
    window = chunk[max(0, start - 36) : min(len(chunk), end + 54)].lower()
    return bool(re.search(r"\b(mwk|mk|kwacha|per\s+lit(?:re|er)|/l|lit(?:re|er))\b", window))


def _looks_like_year_without_currency(chunk, value, start, end):
    if not 1900 <= value <= 2100 or value % 1 != 0:
        return False
    window = chunk[max(0, start - 12) : min(len(chunk), end + 12)].lower()
    if re.search(r"\b(mwk|mk|kwacha)\b", window):
        return False
    if re.search(r"\b(per\s+lit(?:re|er)|/l|lit(?:re|er))\b", window):
        return False
    return True


def _score_market_chunk(chunk, keyword_pattern, value_position):
    lower = chunk.lower()
    score = 0
    if re.search(keyword_pattern, lower):
        score += 6
    if re.search(r"\b(mwk|mk|kwacha)\b", lower):
        score += 4
    if re.search(r"\b(per\s+lit(?:re|er)|/l|lit(?:re|er))\b", lower):
        score += 3
    if re.search(r"\b(price|pump|retail|sell|selling|cost)\b", lower):
        score += 2
    if re.search(r"\b(2025|2026|today|current|latest|now)\b", lower):
        score += 1

    keyword_match = re.search(keyword_pattern, lower)
    if keyword_match:
        score -= min(abs(value_position - keyword_match.start()) / 50, 4)
    return score


def _extract_number_for_keywords(text, keywords, minimum, maximum):
    keyword_pattern = r"\b(?:" + "|".join(re.escape(keyword) for keyword in keywords) + r")\b"
    best = None

    for chunk in _sentence_chunks(text):
        if not re.search(keyword_pattern, chunk, re.IGNORECASE):
            continue
        if not re.search(r"\b(mwk|mk|kwacha|per\s+lit(?:re|er)|/l|lit(?:re|er)|price|pump)\b", chunk, re.IGNORECASE):
            continue

        for value, position, end in _numbers_in_range(chunk, minimum, maximum):
            if not _has_price_unit_nearby(chunk, position, end):
                continue
            if _looks_like_year_without_currency(chunk, value, position, end):
                continue
            score = _score_market_chunk(chunk, keyword_pattern, position)
            if best is None or score > best[0]:
                best = (score, value)

    return best[1] if best else None


def _extract_usd_mwk_rate(text):
    patterns = (
        r"\b1\s*(?:usd|us\s*dollar)[^0-9]{0,80}(?:mwk|malawian\s+kwacha|kwacha)[^0-9]{0,30}([0-9][0-9,]*(?:\.\d+)?)",
        r"\b(?:usd|us\s*dollar)\s*(?:/|to)?\s*(?:mwk|malawian\s+kwacha|kwacha)[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)",
        r"\b(?:mwk|malawian\s+kwacha|kwacha)\s*(?:/|per|to)\s*(?:usd|us\s*dollar)[^0-9]{0,40}([0-9][0-9,]*(?:\.\d+)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = _number_or_none(match.group(1))
            if value is not None and USD_MWK_VALUE_RANGE[0] <= value <= USD_MWK_VALUE_RANGE[1]:
                return value

    return _extract_number_for_keywords(
        text,
        ("usd", "dollar", "exchange", "forex", "kwacha"),
        USD_MWK_VALUE_RANGE[0],
        USD_MWK_VALUE_RANGE[1],
    )


def _extract_supply_alert(text):
    for chunk in _sentence_chunks(text):
        if re.search(r"\b(nocma|supply|shortage|fuel\s+crisis|stockout|import)\b", chunk, re.IGNORECASE):
            snippet = re.sub(r"^.*?\bSnippet:\s*", "", chunk)
            return snippet[:260]
    return None


def _is_malawi_fuel_result(text):
    return bool(MALAWI_RE.search(text) and FUEL_RE.search(text))


def _is_relevant_search_result(query, text, require_fuel=False):
    haystack = text.lower()
    query_lower = query.lower()
    if require_fuel:
        return _is_malawi_fuel_result(text)
    if "usd" in query_lower or "exchange" in query_lower:
        return bool(re.search(r"\b(mwk|kwacha|malawi)\b", haystack))
    return _is_malawi_fuel_result(text)


def _clean_source_record(record):
    return {
        "source": record.get("source"),
        "source_type": record.get("source_type"),
        "reliability": record.get("reliability"),
        "title": record.get("title"),
        "url": record.get("url"),
        "query": record.get("query"),
    }


def _extract_market_candidates(raw_context, source_records=None):
    source_records = source_records or []
    if not raw_context:
        return _safe_market_data("No DuckDuckGo market snippets were available.")

    petrol = _extract_number_for_keywords(
        raw_context,
        ("petrol", "gasoline", "ulp"),
        FUEL_VALUE_RANGE[0],
        FUEL_VALUE_RANGE[1],
    )
    diesel = _extract_number_for_keywords(
        raw_context,
        ("diesel", "gasoil"),
        FUEL_VALUE_RANGE[0],
        FUEL_VALUE_RANGE[1],
    )
    kerosene = _extract_number_for_keywords(
        raw_context,
        ("kerosene", "paraffin"),
        FUEL_VALUE_RANGE[0],
        FUEL_VALUE_RANGE[1],
    )
    usd_mwk = _extract_usd_mwk_rate(raw_context)
    supply_alert = _extract_supply_alert(raw_context)

    found_values = [value for value in (petrol, diesel, kerosene, usd_mwk) if value is not None]
    source_names = []
    for record in source_records:
        source = record.get("source")
        if source and source not in source_names:
            source_names.append(source)

    if found_values:
        note = "Parsed market figures from DuckDuckGo snippets; verify before changing pump prices."
    elif source_names:
        note = f"Reviewed Malawi fuel news snippets from {', '.join(source_names[:4])}; no verified pump-price or exchange-rate figures were found."
    else:
        note = "DuckDuckGo snippets did not include verified MWK price or exchange-rate figures."

    return {
        "petrol_price_mwk": petrol,
        "diesel_price_mwk": diesel,
        "kerosene_price_mwk": kerosene,
        "usd_mwk_rate": usd_mwk,
        "supply_alert": supply_alert,
        "market_note": note,
        "fetched_at": _utc_now_iso(),
        "sources": [_clean_source_record(record) for record in source_records[:8]],
    }


def _collect_search_records(ddgs, query, source_profile=None, require_fuel=False):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        stderr_buffer = io.StringIO()
        with contextlib.redirect_stderr(stderr_buffer):
            results = ddgs.text(
                query,
                region="wt-wt",
                safesearch="moderate",
                backend="auto",
                max_results=4,
            ) or []

    records = []
    for result in results:
        if isinstance(result, dict):
            title = str(result.get("title") or "").strip()
            body = str(result.get("body") or "").strip()
            url = str(result.get("href") or result.get("url") or "").strip()
            combined = " - ".join(part for part in (title, body) if part)
            if body and _is_relevant_search_result(query, combined, require_fuel=require_fuel):
                profile = source_profile if _can_apply_source_profile(source_profile, url) else None
                records.append(
                    {
                        "query": query,
                        "source": (profile or {}).get("source") or _infer_source_name(title, url),
                        "source_type": (profile or {}).get("source_type") or _infer_source_type(url),
                        "reliability": (profile or {}).get("reliability") or _infer_reliability(url),
                        "title": title or None,
                        "url": url or None,
                        "body": body,
                    }
                )
    return records


def _can_apply_source_profile(source_profile, url):
    if not source_profile:
        return False
    if source_profile.get("source_type") != "official":
        return True

    lower = str(url or "").lower()
    source = str(source_profile.get("source") or "").lower()
    if "energy regulatory" in source:
        return "mera.mw" in lower
    if "nocma" in source:
        return "nocma" in lower
    return False


def _infer_source_name(title, url):
    value = f"{title} {url}".lower()
    if "mera.mw" in value:
        return "Malawi Energy Regulatory Authority"
    if "nocma" in value and re.search(r"\bnocma\.[a-z]", value):
        return "NOCMA"
    if "nyasa" in value:
        return "Malawi Nyasa Times"
    if "times" in value:
        return "Times 360"
    if "malawi24.com" in value:
        return "Malawi24"
    if "news24.com" in value:
        return "News24"
    if "zodiak" in value:
        return "Zodiak Online"
    if "mbc" in value:
        return "MBC Online"
    if "nation" in value:
        return "Nation Publications"
    if "facebook.com" in value:
        return "Facebook public snippet"
    return "DuckDuckGo result"


def _infer_source_type(url):
    lower = str(url or "").lower()
    if "mera.mw" in lower or re.search(r"\bnocma\.[a-z]", lower):
        return "official"
    if "facebook.com" in lower:
        return "public_facebook_page"
    return "web"


def _infer_reliability(url):
    source_type = _infer_source_type(url)
    if source_type == "official":
        return "official"
    if source_type == "public_facebook_page":
        return "public_news_snippet"
    return "search_snippet"


def _format_search_record(record):
    source = record.get("source") or "Unknown source"
    reliability = record.get("reliability") or "search_snippet"
    title = record.get("title") or "Untitled"
    url = record.get("url") or "No URL"
    body = record.get("body") or ""
    return f"Source: {source} [{reliability}]\nTitle: {title}\nURL: {url}\nSnippet: {body}"


def _append_records(context_parts, source_records, heading, records):
    if not records:
        return
    available_slots = max(0, MAX_MARKET_RECORDS - len(source_records))
    if available_slots <= 0:
        return
    selected = records[:available_slots]
    source_records.extend(selected)
    context_parts.append(heading + "\n" + "\n\n".join(_format_search_record(record) for record in selected))


def _open_ddgs(DDGS, deadline):
    timeout = min(
        _env_float("SMARTLINK_DUCKDUCKGO_TIMEOUT_SECONDS", DEFAULT_DUCKDUCKGO_TIMEOUT_SECONDS),
        max(1.0, _seconds_remaining(deadline)),
    )
    return DDGS(timeout=int(timeout), verify=False)


def _string_or_none(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _normalize_market_data(parsed, fetched_at):
    if not isinstance(parsed, dict):
        raise ValueError("Groq market response was not a JSON object")
    return {
        "petrol_price_mwk": _fuel_price_or_none(parsed.get("petrol_price_mwk")),
        "diesel_price_mwk": _fuel_price_or_none(parsed.get("diesel_price_mwk")),
        "kerosene_price_mwk": _fuel_price_or_none(parsed.get("kerosene_price_mwk")),
        "usd_mwk_rate": _usd_mwk_or_none(parsed.get("usd_mwk_rate")),
        "supply_alert": _string_or_none(parsed.get("supply_alert")),
        "market_note": _string_or_none(parsed.get("market_note")),
        "fetched_at": fetched_at,
    }


def _number_variants(number):
    if number is None:
        return ()
    as_float = float(number)
    variants = {
        str(int(as_float)) if as_float.is_integer() else str(as_float),
        f"{as_float:,.0f}" if as_float.is_integer() else f"{as_float:,.2f}",
        f"{as_float:,.1f}",
        f"{as_float:.1f}",
        f"{as_float:.2f}",
    }
    return tuple(variant.rstrip("0").rstrip(".") for variant in variants if variant)


def _chunk_supports_value(chunk, value, keyword_pattern, require_price_unit=False):
    lower = chunk.lower()
    if not re.search(keyword_pattern, lower):
        return False

    for variant in _number_variants(value):
        if not variant:
            continue
        position = lower.find(variant.lower())
        if position < 0:
            continue
        end = position + len(variant)
        if require_price_unit and not _has_price_unit_nearby(chunk, position, end):
            continue
        return True
    return False


def _context_supports_fuel_value(raw_context, value, keywords):
    keyword_pattern = r"\b(?:" + "|".join(re.escape(keyword) for keyword in keywords) + r")\b"
    return any(_chunk_supports_value(chunk, value, keyword_pattern, require_price_unit=True) for chunk in _sentence_chunks(raw_context))


def _context_supports_usd_mwk_value(raw_context, value):
    keyword_pattern = r"\b(usd|dollar|mwk|kwacha|exchange|forex)\b"
    return any(_chunk_supports_value(chunk, value, keyword_pattern, require_price_unit=False) for chunk in _sentence_chunks(raw_context))


def _validated_market_data(parsed, fetched_at, raw_context):
    data = _normalize_market_data(parsed, fetched_at)
    fuel_keywords = {
        "petrol_price_mwk": ("petrol", "gasoline", "ulp"),
        "diesel_price_mwk": ("diesel", "gasoil"),
        "kerosene_price_mwk": ("kerosene", "paraffin"),
    }
    for key, keywords in fuel_keywords.items():
        if data.get(key) is not None and not _context_supports_fuel_value(raw_context, data[key], keywords):
            data[key] = None
    if data.get("usd_mwk_rate") is not None and not _context_supports_usd_mwk_value(raw_context, data["usd_mwk_rate"]):
        data["usd_mwk_rate"] = None
    return data


def _fuel_price_or_none(value):
    number = _number_or_none(value)
    if number is None:
        return None
    if FUEL_VALUE_RANGE[0] <= number <= FUEL_VALUE_RANGE[1]:
        return number
    return None


def _usd_mwk_or_none(value):
    number = _number_or_none(value)
    if number is None:
        return None
    if USD_MWK_VALUE_RANGE[0] <= number <= USD_MWK_VALUE_RANGE[1]:
        return number
    return None


def _merge_market_data(primary, fallback, fetched_at, raw_context):
    merged = _validated_market_data(primary, fetched_at, raw_context)
    for key in MARKET_SCHEMA_KEYS:
        if key == "fetched_at":
            continue
        if merged.get(key) is None and fallback.get(key) is not None:
            merged[key] = fallback[key]
    merged["fetched_at"] = fetched_at
    merged["sources"] = fallback.get("sources") or []
    return merged


def _call_groq_market_parser(raw_context, fetched_at, fallback_data):
    _load_environment()
    try:
        from groq import Groq
    except Exception as exc:
        raise RuntimeError(f"Groq SDK unavailable: {exc}") from exc

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    system_prompt = """You are a fuel market data extractor for Malawi.
Extract structured data from the search results provided.
Use only information that is about fuel in Malawi or USD/MWK exchange rates.
Treat public Facebook-page snippets and local news snippets as news leads, not official pump prices.
Prefer MERA/NOCMA or clearly cited MWK-per-litre snippets for prices.
Return ONLY valid JSON, no markdown, no code fences, nothing else.
If a value cannot be found in the text, use null.
Schema:
{
  petrol_price_mwk: number | null,
  diesel_price_mwk: number | null,
  kerosene_price_mwk: number | null,
  usd_mwk_rate: number | null,
  supply_alert: string | null,
  market_note: string | null,
  fetched_at: ISO timestamp string
}"""

    user_prompt = json.dumps(
        {
            "fetched_at": fetched_at,
            "search_results_context": raw_context,
        },
        ensure_ascii=True,
    )

    client = Groq(
        api_key=api_key,
        timeout=_env_float("SMARTLINK_GROQ_TIMEOUT_SECONDS", DEFAULT_GROQ_TIMEOUT_SECONDS),
    )
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0,
    )
    content = response.choices[0].message.content
    return _merge_market_data(_json_from_content(content), fallback_data, fetched_at, raw_context)


def fetch_market_intelligence() -> dict:
    fetched_at = _utc_now_iso()
    context_parts = []
    source_records = []
    deadline = time.monotonic() + _env_float(
        "SMARTLINK_MARKET_SEARCH_BUDGET_SECONDS",
        DEFAULT_MARKET_SEARCH_BUDGET_SECONDS,
    )

    try:
        from duckduckgo_search import DDGS
    except Exception as exc:
        DDGS = None
        _log_error(f"DuckDuckGo search unavailable: {exc}")

    if DDGS is not None:
        for query in SEARCH_QUERIES:
            if not _has_time(deadline) or len(source_records) >= MAX_MARKET_RECORDS:
                break
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    stderr_buffer = io.StringIO()
                    with contextlib.redirect_stderr(stderr_buffer), _open_ddgs(DDGS, deadline) as ddgs:
                        records = _collect_search_records(ddgs, query)
                        for fallback_query in FALLBACK_SEARCH_QUERIES.get(query, ()):
                            if records or not _has_time(deadline, minimum=1.0):
                                break
                            records = _collect_search_records(ddgs, fallback_query)
                _append_records(context_parts, source_records, "Search results:", records)
            except Exception as exc:
                _log_error(f"DuckDuckGo search failed for {query!r}: {exc}")

        news_searches = 0
        for profile in TRUSTED_FUEL_NEWS_SOURCES:
            if not _has_time(deadline) or len(source_records) >= MAX_MARKET_RECORDS:
                break
            for query in profile["queries"]:
                if (
                    not _has_time(deadline)
                    or len(source_records) >= MAX_MARKET_RECORDS
                    or news_searches >= _env_int("SMARTLINK_MAX_FUEL_NEWS_SEARCHES", MAX_NEWS_SEARCHES)
                ):
                    break
                try:
                    news_searches += 1
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        stderr_buffer = io.StringIO()
                        with contextlib.redirect_stderr(stderr_buffer), _open_ddgs(DDGS, deadline) as ddgs:
                            records = _collect_search_records(ddgs, query, source_profile=profile, require_fuel=True)
                    if records:
                        _append_records(context_parts, source_records, f"Malawi fuel news source: {profile['source']}", records)
                        break
                except Exception as exc:
                    _log_error(f"DuckDuckGo fuel-news search failed for {query!r}: {exc}")

    raw_context = "\n\n".join(context_parts).strip()[:MAX_MARKET_CONTEXT_CHARS]
    fallback_data = _extract_market_candidates(raw_context, source_records)
    if not raw_context:
        fallback_data["fetched_at"] = fetched_at
        return fallback_data

    try:
        return _call_groq_market_parser(raw_context, fetched_at, fallback_data)
    except Exception as exc:
        _log_error(f"Groq market extraction failed: {exc}")
        fallback_data["fetched_at"] = fetched_at
        if fallback_data.get("market_note"):
            fallback_data["market_note"] = f"{fallback_data['market_note']} Groq extraction unavailable: {exc}"
        else:
            fallback_data["market_note"] = f"Market intelligence unavailable: {exc}"
        return fallback_data
