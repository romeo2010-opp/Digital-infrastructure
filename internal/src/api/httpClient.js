import { clearSession, readSession, writeSession } from "../auth/session"

const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

async function request(path, options = {}) {
  const session = readSession()
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    const message = payload.error || `Request failed: ${response.status}`
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new CustomEvent("smartlink:internal-auth-expired"))
    }
    throw new Error(message)
  }

  if (payload?.data?.accessToken && session) {
    writeSession({
      ...session,
      accessToken: payload.data.accessToken,
    })
  }

  return payload.data
}

async function requestBlob(path, options = {}) {
  const session = readSession()
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const payload = await response.json()
      if (payload?.error) message = payload.error
    } catch {
      // Ignore non-JSON bodies for blob requests.
    }
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new CustomEvent("smartlink:internal-auth-expired"))
    }
    throw new Error(message)
  }

  return response.blob()
}

async function requestBlobWithMeta(path, options = {}) {
  const session = readSession()
  const response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const payload = await response.json()
      if (payload?.error) message = payload.error
    } catch {
      // Ignore non-JSON bodies for blob requests.
    }
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new CustomEvent("smartlink:internal-auth-expired"))
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get("content-disposition") || ""
  const filenameUtf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const filenameAsciiMatch = disposition.match(/filename="([^"]+)"/i)
  const filename = filenameUtf8Match
    ? decodeURIComponent(filenameUtf8Match[1])
    : filenameAsciiMatch?.[1] || null

  return {
    blob,
    filename,
    contentType: response.headers.get("content-type") || blob.type || "",
  }
}

export const httpClient = {
  get(path) {
    return request(path)
  },
  post(path, body) {
    return request(path, { method: "POST", body: JSON.stringify(body || {}) })
  },
  postForm(path, body) {
    return request(path, { method: "POST", body })
  },
  patch(path, body) {
    return request(path, { method: "PATCH", body: JSON.stringify(body || {}) })
  },
  delete(path) {
    return request(path, { method: "DELETE" })
  },
  getBlob(path) {
    return requestBlob(path)
  },
  getBlobWithMeta(path) {
    return requestBlobWithMeta(path)
  },
}
