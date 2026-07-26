import bcrypt from "bcryptjs"
import { pool } from "../config/db.js"
import { signTeamSession } from "../middleware/teamAuth.js"
import { loadTeamPrincipal } from "../services/teamAccessService.js"
import { requiredText, writeTeamAudit } from "../services/teamSuiteService.js"
import { safeTeamRequestMetadata } from "../middleware/teamAuth.js"
import { HttpError } from "../utils/http.js"

function validatePassword(password) {
  const value = String(password || "")
  if (value.length < 10) throw new HttpError(400, "New password must be at least 10 characters")
  if (!/[A-Z]/.test(value)) throw new HttpError(400, "New password needs an uppercase letter")
  if (!/[a-z]/.test(value)) throw new HttpError(400, "New password needs a lowercase letter")
  if (!/[0-9]/.test(value)) throw new HttpError(400, "New password needs a number")
  if (!/[^A-Za-z0-9]/.test(value)) throw new HttpError(400, "New password needs a symbol")
  return value
}

export async function teamLogin(req, res) {
  const email = requiredText(req.body?.email, "Email address", 190).toLowerCase()
  const password = String(req.body?.password || "")
  if (!password) throw new HttpError(401, "Invalid credentials")
  let user
  try {
    [[user]] = await pool.query(
      `SELECT id,password_hash,is_active FROM team_users WHERE LOWER(email)=? LIMIT 1`,
      [email],
    )
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_TABLE_ERROR"].includes(error?.code)) {
      throw new HttpError(503, "SmartLink Team Suite is not installed yet. Apply database migration 066.", {
        code: "TEAM_SUITE_MIGRATION_REQUIRED",
      })
    }
    throw error
  }
  const valid = user?.is_active && await bcrypt.compare(password, String(user.password_hash || "")).catch(() => false)
  if (!valid) throw new HttpError(401, "Invalid credentials")

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query("UPDATE team_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?", [user.id])
    await writeTeamAudit(connection, {
      actorUserId: user.id,
      action: "TEAM_USER_LOGIN",
      entityType: "team_user",
      entityId: user.id,
      ...safeTeamRequestMetadata(req),
    })
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  const principal = await loadTeamPrincipal(user.id)
  res.json({ access_token: signTeamSession(principal), user: principal })
}

export async function teamMe(req, res) {
  res.json({ user: req.teamUser })
}

export async function teamChangePassword(req, res) {
  const currentPassword = String(req.body?.current_password || req.body?.currentPassword || "")
  const newPassword = validatePassword(req.body?.new_password || req.body?.newPassword)
  const confirmation = String(req.body?.confirm_password || req.body?.confirmPassword || "")
  if (newPassword !== confirmation) throw new HttpError(400, "New passwords do not match")
  const [[stored]] = await pool.query("SELECT password_hash FROM team_users WHERE id=? AND is_active=1 LIMIT 1", [req.teamUser.id])
  if (!stored || !(await bcrypt.compare(currentPassword, stored.password_hash))) {
    throw new HttpError(401, "Current password is incorrect")
  }
  if (await bcrypt.compare(newPassword, stored.password_hash)) {
    throw new HttpError(400, "Choose a password that is different from the current password")
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const hash = await bcrypt.hash(newPassword, 12)
    await connection.query(
      `UPDATE team_users
       SET password_hash=?,must_change_password=0,password_changed_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [hash, req.teamUser.id],
    )
    await writeTeamAudit(connection, {
      actorUserId: req.teamUser.id,
      action: "TEAM_PASSWORD_CHANGED",
      entityType: "team_user",
      entityId: req.teamUser.id,
      ...safeTeamRequestMetadata(req),
    })
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
  const principal = await loadTeamPrincipal(req.teamUser.id)
  res.json({ access_token: signTeamSession(principal), user: principal })
}

