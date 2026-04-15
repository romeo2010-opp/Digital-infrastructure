import { useEffect, useMemo, useState } from "react";
import Navbar from "../../components/Navbar";
import { promotionsApi } from "../../api/promotionsApi";
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher";
import "../settings/settings.css";
import "./promotions.css";

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E";

const INITIAL_FORM = {
  name: "",
  description: "",
  campaignLabel: "",
  promotionKind: "DISCOUNT",
  fuelTypeCode: "PETROL",
  fundingSource: "STATION",
  stationSharePct: "100",
  smartlinkSharePct: "0",
  discountMode: "PERCENTAGE_PER_LITRE",
  discountValue: "",
  cashbackMode: "",
  cashbackValue: "",
  cashbackDestination: "WALLET",
  flashPricePerLitre: "",
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  maxLitres: "",
  isActive: true,
  minLitres: "",
  paymentMethods: [],
};

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "MWK -";
  const whole = Math.abs(numeric % 1) < 0.001;
  return `MWK ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countdownLabel(value, nowTick) {
  if (!value) return "No timer";
  const diffMs = new Date(value).getTime() - nowTick;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "Expired";
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusClass(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "active")
    return "promotions-status promotions-status--active";
  if (normalized === "scheduled")
    return "promotions-status promotions-status--scheduled";
  if (normalized === "expired")
    return "promotions-status promotions-status--expired";
  return "promotions-status promotions-status--inactive";
}

function friendlyType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "FLASH_PRICE") return "Flash Fuel Price";
  if (normalized === "CASHBACK") return "Cashback";
  return "Discount";
}

function paymentMethodToggle(nextMethod, selected) {
  if (selected.includes(nextMethod)) {
    return selected.filter((item) => item !== nextMethod);
  }
  return [...selected, nextMethod];
}

function appliedCampaignMap(preview) {
  const applied = Array.isArray(preview?.pricing?.appliedCampaigns)
    ? preview.pricing.appliedCampaigns
    : [];
  return new Map(applied.map((item) => [item.campaignPublicId, item]));
}

function eligibilityCampaignMap(preview) {
  const items = Array.isArray(preview?.pricing?.eligibility)
    ? preview.pricing.eligibility
    : [];
  return new Map(items.map((item) => [item.campaignPublicId, item]));
}

function formatUsageCaps(campaign) {
  const maxRedemptions = Number(campaign?.maxRedemptions || 0);
  const redeemedCount = Number(campaign?.redeemedCount || 0);
  const maxLitres = Number(campaign?.maxLitres || 0);
  const redeemedLitres = Number(campaign?.redeemedLitres || 0);

  const parts = [];

  if (maxRedemptions > 0) {
    parts.push(`${redeemedCount}/${maxRedemptions} redemptions used`);
  } else {
    parts.push("No redemption cap");
  }

  if (maxLitres > 0) {
    parts.push(
      `${redeemedLitres.toLocaleString()}L/${maxLitres.toLocaleString()}L used`,
    );
  } else {
    parts.push("No litre cap");
  }

  return parts.join(" · ");
}

function previewEligibilityLabel(appliedPreview, eligibilityPreview) {
  if (appliedPreview) return "Eligible for this preview";
  if (eligibilityPreview?.isEligible)
    return "Eligible, not selected in preview";
  const reasons = Array.isArray(eligibilityPreview?.reasons)
    ? eligibilityPreview.reasons.filter(Boolean)
    : [];
  return reasons[0] || "Not eligible for this preview";
}

function normalizeFormByPromotionKind(currentForm, nextPromotionKind) {
  const normalizedKind = String(
    nextPromotionKind || currentForm.promotionKind || "DISCOUNT",
  )
    .trim()
    .toUpperCase();

  if (normalizedKind === "FLASH_PRICE") {
    return {
      ...currentForm,
      promotionKind: "FLASH_PRICE",
      discountMode: "FLASH_PRICE_PER_LITRE",
      discountValue: "",
      cashbackMode: "",
      cashbackValue: "",
      flashPricePerLitre: currentForm.flashPricePerLitre || "",
      cashbackDestination: "WALLET",
    };
  }

  if (normalizedKind === "CASHBACK") {
    return {
      ...currentForm,
      promotionKind: "CASHBACK",
      discountMode: "",
      discountValue: "",
      flashPricePerLitre: "",
      cashbackMode: currentForm.cashbackMode || "PERCENTAGE",
      cashbackValue: currentForm.cashbackValue || "",
    };
  }

  return {
    ...currentForm,
    promotionKind: "DISCOUNT",
    discountMode:
      currentForm.discountMode &&
      currentForm.discountMode !== "FLASH_PRICE_PER_LITRE"
        ? currentForm.discountMode
        : "PERCENTAGE_PER_LITRE",
    discountValue: currentForm.discountValue || "",
    cashbackMode: "",
    cashbackValue: "",
    flashPricePerLitre: "",
    cashbackDestination: "WALLET",
  };
}

export default function StationPromotionsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingCampaignId, setEditingCampaignId] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewForm, setPreviewForm] = useState({
    fuelTypeCode: "PETROL",
    litres: "40",
    paymentMethod: "CASH",
  });
  const [preview, setPreview] = useState(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [expiredModalOpen, setExpiredModalOpen] = useState(false);
  const isDiscountKind = form.promotionKind === "DISCOUNT";
  const isFlashKind = form.promotionKind === "FLASH_PRICE";
  const isCashbackKind = form.promotionKind === "CASHBACK";

  async function refreshPreview(currentPreviewForm = previewForm) {
    try {
      const result = await promotionsApi.preview({
        fuelTypeCode: currentPreviewForm.fuelTypeCode,
        litres: Number(currentPreviewForm.litres || 0) || 40,
        paymentMethod: currentPreviewForm.paymentMethod,
        cashbackDestination: "WALLET",
      });
      setPreview(result);
    } catch (previewError) {
      setPreview(null);
      setError(previewError?.message || "Unable to load pricing preview");
    }
  }

  async function refresh() {
    try {
      setLoading(true);
      setError("");
      const [campaigns] = await Promise.all([
        promotionsApi.list(),
        refreshPreview(previewForm),
      ]);
      setData(campaigns);
    } catch (requestError) {
      setError(requestError?.message || "Unable to load promotion campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useStationChangeWatcher({
    onChange: async () => {
      await refresh();
    },
  });

  const previewCampaigns = useMemo(
    () => appliedCampaignMap(preview),
    [preview],
  );
  const previewEligibility = useMemo(
    () => eligibilityCampaignMap(preview),
    [preview],
  );

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const normalizedForm = normalizeFormByPromotionKind(
        form,
        form.promotionKind,
      );
      const payload = {
        name: normalizedForm.name,
        description: normalizedForm.description || undefined,
        campaignLabel: normalizedForm.campaignLabel || undefined,
        promotionKind: normalizedForm.promotionKind,
        fuelTypeCode: normalizedForm.fuelTypeCode,
        fundingSource: normalizedForm.fundingSource,
        stationSharePct: Number(normalizedForm.stationSharePct || 0),
        smartlinkSharePct: Number(normalizedForm.smartlinkSharePct || 0),
        discountMode:
          normalizedForm.promotionKind === "DISCOUNT"
            ? normalizedForm.discountMode || undefined
            : undefined,
        discountValue:
          normalizedForm.promotionKind === "DISCOUNT" &&
          normalizedForm.discountValue
            ? Number(normalizedForm.discountValue)
            : undefined,
        cashbackMode:
          normalizedForm.promotionKind === "CASHBACK"
            ? normalizedForm.cashbackMode || undefined
            : undefined,
        cashbackValue:
          normalizedForm.promotionKind === "CASHBACK" &&
          normalizedForm.cashbackValue
            ? Number(normalizedForm.cashbackValue)
            : undefined,
        cashbackDestination:
          normalizedForm.promotionKind === "CASHBACK"
            ? normalizedForm.cashbackDestination
            : undefined,
        flashPricePerLitre:
          normalizedForm.promotionKind === "FLASH_PRICE" &&
          normalizedForm.flashPricePerLitre
            ? Number(normalizedForm.flashPricePerLitre)
            : undefined,
        startsAt: new Date(normalizedForm.startsAt).toISOString(),
        endsAt: new Date(normalizedForm.endsAt).toISOString(),
        isActive: normalizedForm.isActive,
        status: normalizedForm.isActive ? "ACTIVE" : "INACTIVE",
        maxRedemptions: normalizedForm.maxRedemptions
          ? Number(normalizedForm.maxRedemptions)
          : undefined,
        maxLitres: normalizedForm.maxLitres
          ? Number(normalizedForm.maxLitres)
          : undefined,
        eligibilityRules: {
          minLitres: normalizedForm.minLitres
            ? Number(normalizedForm.minLitres)
            : undefined,
          paymentMethods: normalizedForm.paymentMethods.length
            ? normalizedForm.paymentMethods
            : undefined,
        },
      };

      if (editingCampaignId) {
        await promotionsApi.update(editingCampaignId, payload);
        setMessage("Campaign updated");
      } else {
        await promotionsApi.create(payload);
        setMessage("Campaign created");
      }
      setEditingCampaignId("");
      setForm(INITIAL_FORM);
      await refresh();
    } catch (saveError) {
      setError(saveError?.message || "Unable to save campaign");
    } finally {
      setSaving(false);
    }
  }

  function loadCampaignForEdit(campaign) {
    setEditingCampaignId(campaign.publicId);
    setForm(
      normalizeFormByPromotionKind(
        {
          name: campaign.name || "",
          description: campaign.description || "",
          campaignLabel: campaign.campaignLabel || "",
          promotionKind: campaign.promotionKind || "DISCOUNT",
          fuelTypeCode: campaign.fuelTypeCode || "PETROL",
          fundingSource: campaign.fundingSource || "STATION",
          stationSharePct: String(campaign.stationSharePct ?? 100),
          smartlinkSharePct: String(campaign.smartlinkSharePct ?? 0),
          discountMode: campaign.discountMode || "PERCENTAGE_PER_LITRE",
          discountValue: campaign.discountValue ?? "",
          cashbackMode: campaign.cashbackMode || "",
          cashbackValue: campaign.cashbackValue ?? "",
          cashbackDestination: campaign.cashbackDestination || "WALLET",
          flashPricePerLitre: campaign.flashPricePerLitre ?? "",
          startsAt: toLocalInputValue(campaign.startsAt),
          endsAt: toLocalInputValue(campaign.endsAt),
          maxRedemptions: campaign.maxRedemptions ?? "",
          maxLitres: campaign.maxLitres ?? "",
          isActive: Boolean(campaign.isActive),
          minLitres: campaign.eligibilityRules?.minLitres ?? "",
          paymentMethods: Array.isArray(
            campaign.eligibilityRules?.paymentMethods,
          )
            ? campaign.eligibilityRules.paymentMethods
            : [],
        },
        campaign.promotionKind || "DISCOUNT",
      ),
    );
  }

  async function runAction(action, campaign) {
    try {
      setError("");
      if (action === "activate")
        await promotionsApi.activate(campaign.publicId);
      if (action === "deactivate")
        await promotionsApi.deactivate(campaign.publicId);
      if (action === "archive") await promotionsApi.archive(campaign.publicId);
      setMessage(`Campaign ${action}d`);
      await refresh();
    } catch (actionError) {
      setError(actionError?.message || `Unable to ${action} campaign`);
    }
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  const activeInactiveItems = items.filter(
    (campaign) => !["EXPIRED", "ARCHIVED"].includes(campaign.status),
  );
  const expiredItems = items.filter((campaign) =>
    ["EXPIRED", "ARCHIVED"].includes(campaign.status),
  );

  return (
    <div className="settings-page promotions-page">
      <Navbar pagetitle="Promotions" image={avatar} count={0} />
      <section className="settings-shell">
        <article className="settings-hero promotions-hero">
          <div>
            <h2>Discounts, flash fuel prices, and cashback</h2>
            <p>
              Manage station-funded and SmartLink-funded offers with a live
              forecourt pricing preview before anything reaches checkout.
            </p>
          </div>
          <div className="settings-hero-badges">
            <article>
              <span>Total campaigns</span>
              <strong>{data?.summary?.total || 0}</strong>
            </article>
            <article>
              <span>Active now</span>
              <strong>{data?.summary?.active || 0}</strong>
            </article>
            <article>
              <span>Scheduled</span>
              <strong>{data?.summary?.scheduled || 0}</strong>
            </article>
            <article>
              <span>Expired</span>
              <strong>{data?.summary?.expired || 0}</strong>
            </article>
          </div>
          {message ? <p className="settings-message">{message}</p> : null}
          {error ? <p className="settings-error">{error}</p> : null}
        </article>

        <div className="promotions-grid">
          <article className="settings-card promotions-card">
            <div className="promotions-card-header">
              <h3>{editingCampaignId ? "Edit Campaign" : "Create Campaign"}</h3>
              {editingCampaignId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCampaignId("");
                    setForm(INITIAL_FORM);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <form
              className="settings-grid promotions-form"
              onSubmit={handleSubmit}
            >
              <label>
                Campaign name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                Promo label
                <input
                  value={form.campaignLabel}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      campaignLabel: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Fuel type
                <select
                  value={form.fuelTypeCode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fuelTypeCode: event.target.value,
                    }))
                  }
                >
                  <option value="PETROL">PETROL</option>
                  <option value="DIESEL">DIESEL</option>
                </select>
              </label>
              <label className="promotions-form-wide">
                Description
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Promotion kind
                <select
                  value={form.promotionKind}
                  onChange={(event) =>
                    setForm((current) =>
                      normalizeFormByPromotionKind(current, event.target.value),
                    )
                  }
                >
                  <option value="DISCOUNT">Discount</option>
                  <option value="FLASH_PRICE">Flash Fuel Price</option>
                  <option value="CASHBACK">Cashback</option>
                </select>
              </label>
              <label>
                Funding source
                <select
                  value={form.fundingSource}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      fundingSource: event.target.value,
                    }))
                  }
                >
                  <option value="STATION">Station</option>
                  <option value="SMARTLINK">SmartLink</option>
                  <option value="SHARED">Shared</option>
                </select>
              </label>
              {isDiscountKind ? (
                <>
                  <label>
                    Discount mode
                    <select
                      value={form.discountMode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          discountMode: event.target.value,
                        }))
                      }
                    >
                      <option value="PERCENTAGE_PER_LITRE">
                        Percentage / litre
                      </option>
                      <option value="FIXED_PER_LITRE">
                        Fixed amount / litre
                      </option>
                      <option value="FIXED_BASKET">Fixed basket amount</option>
                    </select>
                  </label>
                  <label>
                    Discount value
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.discountValue}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          discountValue: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}
              {isFlashKind ? (
                <>
                  <label>
                    Flash price / litre
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.flashPricePerLitre}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          flashPricePerLitre: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="promotions-kind-note">
                    Flash pricing behavior
                    <div className="promotions-static-note">
                      SmartLink keeps the base pump price intact and applies the
                      flash saving transparently at checkout.
                    </div>
                  </label>
                </>
              ) : null}
              {isCashbackKind ? (
                <>
                  <label>
                    Cashback mode
                    <select
                      value={form.cashbackMode}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cashbackMode: event.target.value,
                        }))
                      }
                    >
                      <option value="PERCENTAGE">Percentage</option>
                      <option value="FIXED_AMOUNT">Fixed amount</option>
                    </select>
                  </label>
                  <label>
                    Cashback value
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cashbackValue}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cashbackValue: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Cashback destination
                    <select
                      value={form.cashbackDestination}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cashbackDestination: event.target.value,
                        }))
                      }
                    >
                      <option value="WALLET">Wallet</option>
                      <option value="LOYALTY">Loyalty</option>
                      <option value="NONE">No credit</option>
                    </select>
                  </label>
                </>
              ) : null}
              <label>
                Station share %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.stationSharePct}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      stationSharePct: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                SmartLink share %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.smartlinkSharePct}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      smartlinkSharePct: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Starts at
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startsAt: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                Ends at
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                Max redemptions
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.maxRedemptions}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxRedemptions: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Max litres
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.maxLitres}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxLitres: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Minimum litres
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minLitres}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      minLitres: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="promotions-toggle">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                />
                <span>Active immediately</span>
              </label>
              <div className="promotions-methods promotions-form-wide">
                <span>Eligible payment methods</span>
                <div className="promotions-chip-row">
                  {["CASH", "MOBILE_MONEY", "CARD", "OTHER", "SMARTPAY"].map(
                    (method) => (
                      <button
                        key={method}
                        type="button"
                        className={
                          form.paymentMethods.includes(method)
                            ? "promotions-chip promotions-chip--active"
                            : "promotions-chip"
                        }
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            paymentMethods: paymentMethodToggle(
                              method,
                              current.paymentMethods,
                            ),
                          }))
                        }
                      >
                        {method}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="promotions-form-actions promotions-form-wide">
                <button type="submit" disabled={saving}>
                  {saving
                    ? "Saving..."
                    : editingCampaignId
                      ? "Update campaign"
                      : "Create campaign"}
                </button>
              </div>
            </form>
          </article>

          <article className="settings-card promotions-card">
            <div className="promotions-card-header">
              <h3>Checkout Preview</h3>
            </div>
            <div className="settings-grid promotions-preview-form">
              <label>
                Fuel type
                <select
                  value={previewForm.fuelTypeCode}
                  onChange={async (event) => {
                    const next = {
                      ...previewForm,
                      fuelTypeCode: event.target.value,
                    };
                    setPreviewForm(next);
                    await refreshPreview(next);
                  }}
                >
                  <option value="PETROL">PETROL</option>
                  <option value="DIESEL">DIESEL</option>
                </select>
              </label>
              <label>
                Litres
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={previewForm.litres}
                  onChange={async (event) => {
                    const next = { ...previewForm, litres: event.target.value };
                    setPreviewForm(next);
                    if (Number(event.target.value) > 0)
                      await refreshPreview(next);
                  }}
                />
              </label>
              <label>
                Payment method
                <select
                  value={previewForm.paymentMethod}
                  onChange={async (event) => {
                    const next = {
                      ...previewForm,
                      paymentMethod: event.target.value,
                    };
                    setPreviewForm(next);
                    await refreshPreview(next);
                  }}
                >
                  <option value="CASH">CASH</option>
                  <option value="MOBILE_MONEY">MOBILE_MONEY</option>
                  <option value="CARD">CARD</option>
                  <option value="OTHER">OTHER</option>
                  <option value="SMARTPAY">SMARTPAY</option>
                </select>
              </label>
            </div>
            {preview ? (
              <div className="promotions-preview-panel">
                <div className="promotions-preview-prices">
                  <div>
                    <span>Official pump price</span>
                    <strong>{formatMoney(preview.basePricePerLitre)}</strong>
                  </div>
                  <div>
                    <span>Effective payable</span>
                    <strong>{formatMoney(preview.pricing.finalPayable)}</strong>
                  </div>
                  <div>
                    <span>Cashback earned</span>
                    <strong>{formatMoney(preview.pricing.cashback)}</strong>
                  </div>
                  <div>
                    <span>Net price / litre</span>
                    <strong>
                      {formatMoney(preview.pricing.effectivePricePerLitre)}
                    </strong>
                  </div>
                </div>
                <div className="promotions-preview-breakdown">
                  <div>
                    <span>Subtotal</span>
                    <strong>{formatMoney(preview.pricing.subtotal)}</strong>
                  </div>
                  <div>
                    <span>Station discount</span>
                    <strong>
                      {formatMoney(preview.pricing.stationDiscount)}
                    </strong>
                  </div>
                  <div>
                    <span>SmartLink discount</span>
                    <strong>
                      {formatMoney(preview.pricing.smartlinkDiscount)}
                    </strong>
                  </div>
                  <div>
                    <span>Total direct discount</span>
                    <strong>
                      {formatMoney(preview.pricing.totalDirectDiscount)}
                    </strong>
                  </div>
                </div>
                <div className="promotions-preview-badges">
                  {(preview.pricing.promoLabelsApplied || []).length ? (
                    preview.pricing.promoLabelsApplied.map((label) => (
                      <span key={label}>{label}</span>
                    ))
                  ) : (
                    <span>No eligible campaign for this checkout</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="promotions-empty-copy">
                Preview will appear once the selected litres and fuel type are
                valid.
              </p>
            )}
          </article>
        </div>

        <article className="settings-card promotions-card">
          <div className="promotions-card-header">
            <h3>Campaign Portfolio</h3>
          </div>
          {loading ? (
            <p className="promotions-empty-copy">Loading campaigns...</p>
          ) : null}
          {!loading && !activeInactiveItems.length ? (
            <p className="promotions-empty-copy">
              No active or inactive campaigns.
            </p>
          ) : null}
          <div className="promotions-list">
            {activeInactiveItems.map((campaign) => {
              const appliedPreview = previewCampaigns.get(campaign.publicId);
              return (
                <article
                  key={campaign.publicId}
                  className="promotions-list-item"
                >
                  <div className="promotions-list-top">
                    <div>
                      <div className="promotions-list-heading">
                        <h4>{campaign.campaignLabel || campaign.name}</h4>
                        <span className={statusClass(campaign.status)}>
                          {campaign.status}
                        </span>
                      </div>
                      <p>
                        {campaign.description ||
                          "No campaign description provided."}
                      </p>
                    </div>
                    <div className="promotions-list-metrics">
                      <span>{friendlyType(campaign.promotionKind)}</span>
                      <span>{campaign.fuelTypeCode || "ALL FUEL"}</span>
                      <span>{campaign.fundingSource}</span>
                    </div>
                  </div>
                  <div className="promotions-list-grid">
                    <div>
                      <span>Window</span>
                      <strong>
                        {formatDateTime(campaign.startsAt)} to{" "}
                        {formatDateTime(campaign.endsAt)}
                      </strong>
                    </div>
                    <div>
                      <span>Usage caps</span>
                      <strong>{formatUsageCaps(campaign)}</strong>
                    </div>
                    <div>
                      <span>Preview station cost</span>
                      <strong>
                        {formatMoney(
                          appliedPreview?.directFunding?.stationAmount || 0,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Preview SmartLink cost</span>
                      <strong>
                        {formatMoney(
                          Number(
                            appliedPreview?.directFunding?.smartlinkAmount || 0,
                          ) +
                            Number(
                              appliedPreview?.cashbackFunding
                                ?.smartlinkAmount || 0,
                            ),
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Customer savings</span>
                      <strong>
                        {formatMoney(appliedPreview?.directDiscountAmount || 0)}
                      </strong>
                    </div>
                    <div>
                      <span>Cashback</span>
                      <strong>
                        {formatMoney(appliedPreview?.cashbackAmount || 0)}
                      </strong>
                    </div>
                    <div>
                      <span>Flash timer</span>
                      <strong>
                        {campaign.promotionKind === "FLASH_PRICE"
                          ? countdownLabel(campaign.endsAt, nowTick)
                          : "Not flash"}
                      </strong>
                    </div>
                    <div>
                      <span>Funding split</span>
                      <strong>
                        {Number(campaign.stationSharePct || 0).toFixed(0)}% /{" "}
                        {Number(campaign.smartlinkSharePct || 0).toFixed(0)}%
                      </strong>
                    </div>
                    <div>
                      <span>Preview eligibility</span>
                      <strong>
                        {previewEligibilityLabel(
                          appliedPreview,
                          previewEligibility.get(campaign.publicId),
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="promotions-actions">
                    <button
                      type="button"
                      onClick={() => loadCampaignForEdit(campaign)}
                    >
                      Edit
                    </button>
                    {campaign.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => runAction("deactivate", campaign)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runAction("activate", campaign)}
                      >
                        Activate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runAction("archive", campaign)}
                    >
                      Archive
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="promotions-actions promotions-actions--bottom">
            <button type="button" onClick={() => setExpiredModalOpen(true)}>
              View Past Promotions
            </button>
          </div>
        </article>
      </section>

      {expiredModalOpen ? (
        <div
          className="promotions-modal-backdrop"
          onClick={() => setExpiredModalOpen(false)}
        >
          <div
            className="promotions-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="promotions-modal-header">
              <h3>Past Promotions</h3>
              <button
                type="button"
                className="promotions-modal-close"
                onClick={() => setExpiredModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="promotions-modal-body">
              {!expiredItems.length ? (
                <p className="promotions-empty-copy">
                  No expired or archived campaigns.
                </p>
              ) : (
                <div className="promotions-list">
                  {expiredItems.map((campaign) => (
                    <article
                      key={campaign.publicId}
                      className="promotions-list-item"
                    >
                      <div className="promotions-list-top">
                        <div>
                          <div className="promotions-list-heading">
                            <h4>{campaign.campaignLabel || campaign.name}</h4>
                            <span className={statusClass(campaign.status)}>
                              {campaign.status}
                            </span>
                          </div>
                          <p>
                            {campaign.description ||
                              "No campaign description provided."}
                          </p>
                        </div>
                        <div className="promotions-list-metrics">
                          <span>{friendlyType(campaign.promotionKind)}</span>
                          <span>{campaign.fuelTypeCode || "ALL FUEL"}</span>
                          <span>{campaign.fundingSource}</span>
                        </div>
                      </div>
                      <div className="promotions-list-grid">
                        <div>
                          <span>Window</span>
                          <strong>
                            {formatDateTime(campaign.startsAt)} to{" "}
                            {formatDateTime(campaign.endsAt)}
                          </strong>
                        </div>
                        <div>
                          <span>Usage caps</span>
                          <strong>{formatUsageCaps(campaign)}</strong>
                        </div>
                        <div>
                          <span>Station cost</span>
                          <strong>{formatMoney(0)}</strong>
                        </div>
                        <div>
                          <span>SmartLink cost</span>
                          <strong>{formatMoney(0)}</strong>
                        </div>
                        <div>
                          <span>Customer savings</span>
                          <strong>{formatMoney(0)}</strong>
                        </div>
                        <div>
                          <span>Cashback</span>
                          <strong>{formatMoney(0)}</strong>
                        </div>
                        <div>
                          <span>Flash timer</span>
                          <strong>
                            {campaign.promotionKind === "FLASH_PRICE"
                              ? countdownLabel(campaign.endsAt, nowTick)
                              : "Not flash"}
                          </strong>
                        </div>
                        <div>
                          <span>Funding split</span>
                          <strong>
                            {Number(campaign.stationSharePct || 0).toFixed(0)}%
                            /{" "}
                            {Number(campaign.smartlinkSharePct || 0).toFixed(0)}
                            %
                          </strong>
                        </div>
                        <div>
                          <span>Eligibility</span>
                          <strong>Not applicable</strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
