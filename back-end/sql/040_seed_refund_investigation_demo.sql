-- 040_seed_refund_investigation_demo.sql
-- Demo refund investigation scenarios with evidence-chain records.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @support_user := (SELECT id FROM users WHERE email = 'support.agent@smartlink.internal' LIMIT 1);
SET @finance_user := (SELECT id FROM users WHERE email = 'finance.manager@smartlink.internal' LIMIT 1);
SET @risk_user := (SELECT id FROM users WHERE email = 'risk.officer@smartlink.internal' LIMIT 1);

SET @customer_one := (SELECT id FROM users WHERE email NOT LIKE '%@smartlink.internal' ORDER BY id ASC LIMIT 1);
SET @customer_two := (SELECT id FROM users WHERE email NOT LIKE '%@smartlink.internal' ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @customer_three := (SELECT id FROM users WHERE email NOT LIKE '%@smartlink.internal' ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @customer_one_public := (SELECT public_id FROM users WHERE id = @customer_one LIMIT 1);
SET @customer_two_public := (SELECT public_id FROM users WHERE id = @customer_two LIMIT 1);
SET @customer_three_public := (SELECT public_id FROM users WHERE id = @customer_three LIMIT 1);

SET @station_valid := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_invalid := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @station_suspicious := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @station_valid_public := (SELECT public_id FROM stations WHERE id = @station_valid LIMIT 1);
SET @station_invalid_public := (SELECT public_id FROM stations WHERE id = @station_invalid LIMIT 1);
SET @station_suspicious_public := (SELECT public_id FROM stations WHERE id = @station_suspicious LIMIT 1);

SET @pump_valid := (SELECT id FROM pumps WHERE station_id = @station_valid ORDER BY id ASC LIMIT 1);
SET @pump_invalid := (SELECT id FROM pumps WHERE station_id = @station_invalid ORDER BY id ASC LIMIT 1);
SET @pump_suspicious := (SELECT id FROM pumps WHERE station_id = @station_suspicious ORDER BY id ASC LIMIT 1);
SET @pump_valid_public := (SELECT public_id FROM pumps WHERE id = @pump_valid LIMIT 1);
SET @pump_invalid_public := (SELECT public_id FROM pumps WHERE id = @pump_invalid LIMIT 1);
SET @pump_suspicious_public := (SELECT public_id FROM pumps WHERE id = @pump_suspicious LIMIT 1);

SET @nozzle_valid := (SELECT id FROM pump_nozzles WHERE station_id = @station_valid AND pump_id = @pump_valid ORDER BY id ASC LIMIT 1);
SET @nozzle_invalid := (SELECT id FROM pump_nozzles WHERE station_id = @station_invalid AND pump_id = @pump_invalid ORDER BY id ASC LIMIT 1);
SET @nozzle_suspicious := (SELECT id FROM pump_nozzles WHERE station_id = @station_suspicious AND pump_id = @pump_suspicious ORDER BY id ASC LIMIT 1);
SET @nozzle_valid_public := (SELECT public_id FROM pump_nozzles WHERE id = @nozzle_valid LIMIT 1);
SET @nozzle_invalid_public := (SELECT public_id FROM pump_nozzles WHERE id = @nozzle_invalid LIMIT 1);
SET @nozzle_suspicious_public := (SELECT public_id FROM pump_nozzles WHERE id = @nozzle_suspicious LIMIT 1);

SET @fuel_valid := (SELECT fuel_type_id FROM pump_nozzles WHERE id = @nozzle_valid LIMIT 1);
SET @fuel_invalid := (SELECT fuel_type_id FROM pump_nozzles WHERE id = @nozzle_invalid LIMIT 1);
SET @fuel_suspicious := (SELECT fuel_type_id FROM pump_nozzles WHERE id = @nozzle_suspicious LIMIT 1);

INSERT INTO queue_entries (
  station_id, public_id, user_id, masked_plate, fuel_type_id, position, status, joined_at, called_at, served_at, metadata
) VALUES
(@station_valid, '01RFQ10000000000000000000', @customer_one, 'BT 9487', @fuel_valid, 1, 'SERVED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 296 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 285 MINUTE),
 JSON_OBJECT('requestedLiters', 25, 'lastPumpScan', JSON_OBJECT('pumpPublicId', @pump_valid_public, 'pumpNumber', 1, 'pumpStatus', 'ONLINE', 'scannedAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 298 MINUTE)))),
(@station_invalid, '01RFQ20000000000000000000', @customer_two, 'LL 2013', @fuel_invalid, 2, 'SERVED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 412 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE),
 JSON_OBJECT('requestedLiters', 35, 'lastPumpScan', JSON_OBJECT('pumpPublicId', @pump_invalid_public, 'pumpNumber', 2, 'pumpStatus', 'ONLINE', 'scannedAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 414 MINUTE)))),
(@station_suspicious, '01RFQ30000000000000000000', @customer_three, 'MZ 7821', @fuel_suspicious, 1, 'SERVED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 9 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 535 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE),
 JSON_OBJECT('requestedLiters', 10, 'lastPumpScan', JSON_OBJECT('pumpPublicId', @pump_suspicious_public, 'pumpNumber', 1, 'pumpStatus', 'ONLINE', 'scannedAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 536 MINUTE))))
ON DUPLICATE KEY UPDATE
  position = VALUES(position),
  status = VALUES(status),
  metadata = VALUES(metadata),
  served_at = VALUES(served_at);

SET @queue_valid_id := (SELECT id FROM queue_entries WHERE public_id = '01RFQ10000000000000000000' LIMIT 1);
SET @queue_invalid_id := (SELECT id FROM queue_entries WHERE public_id = '01RFQ20000000000000000000' LIMIT 1);
SET @queue_suspicious_id := (SELECT id FROM queue_entries WHERE public_id = '01RFQ30000000000000000000' LIMIT 1);

INSERT INTO user_reservations (
  public_id, user_id, station_id, fuel_type_id, source_queue_entry_id, reservation_date, slot_start, slot_end,
  requested_litres, deposit_amount, status, metadata, confirmed_at, check_in_time, fulfilled_at, expires_at
) VALUES
('RSV-RFD-VALID-20260312-0001', @customer_one, @station_valid, @fuel_valid, @queue_valid_id, CURRENT_DATE(),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 270 MINUTE),
 25.00, 15000.00, 'FULFILLED',
 JSON_OBJECT('qrToken', 'VALID-RFD-A', 'checkInMethod', 'QR', 'checkInAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 297 MINUTE)),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 298 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 297 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 285 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 260 MINUTE)),
('RSV-RFD-INVALID-20260312-0001', @customer_two, @station_invalid, @fuel_invalid, @queue_invalid_id, CURRENT_DATE(),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 380 MINUTE),
 35.00, 28000.00, 'FULFILLED',
 JSON_OBJECT('qrToken', 'VALID-RFD-B', 'checkInMethod', 'QR', 'checkInAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 413 MINUTE)),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 415 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 413 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 360 MINUTE)),
('RSV-RFD-SUSPICIOUS-20260312-0001', @customer_three, @station_suspicious, @fuel_suspicious, @queue_suspicious_id, CURRENT_DATE(),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 9 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 500 MINUTE),
 10.00, 8000.00, 'FULFILLED',
 JSON_OBJECT('qrToken', 'VALID-RFD-C', 'checkInMethod', 'QR', 'checkInAt', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 536 MINUTE)),
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 538 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 536 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 480 MINUTE))
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  metadata = VALUES(metadata),
  requested_litres = VALUES(requested_litres),
  fulfilled_at = VALUES(fulfilled_at);

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, authorized_at, dispensed_at, settled_at, litres, price_per_litre, total_amount, requested_litres,
  payment_method, queue_entry_id, status, settlement_impact_status, workflow_reason_code, workflow_note
) VALUES
(@station_valid, 'TXN-RFD-VALID-20260312-0001', @pump_valid, @nozzle_valid, @customer_one, 'RSV-RFD-VALID-20260312-0001', 'PAY-RFD-VALID-0001', @fuel_valid,
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 286 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 287 MINUTE), NULL, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 285 MINUTE),
 0.000, 600.0000, 15000.00, 25.000, 'MOBILE_MONEY', @queue_valid_id, 'UNDER_REVIEW', 'UNCHANGED', 'DISPENSE_FAILURE', 'Payment captured but session failed before fuel flow.'),
(@station_invalid, 'TXN-RFD-INVALID-20260312-0001', @pump_invalid, @nozzle_invalid, @customer_two, 'RSV-RFD-INVALID-20260312-0001', 'PAY-RFD-INVALID-0001', @fuel_invalid,
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 394 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 393 MINUTE),
 35.000, 800.0000, 28000.00, 35.000, 'MOBILE_MONEY', @queue_invalid_id, 'RECORDED', 'UNCHANGED', NULL, NULL),
(@station_suspicious, 'TXN-RFD-SUSPICIOUS-20260312-0001', @pump_suspicious, @nozzle_suspicious, @customer_three, 'RSV-RFD-SUSPICIOUS-20260312-0001', 'PAY-RFD-SUSPICIOUS-0001', @fuel_suspicious,
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 519 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 521 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 518 MINUTE),
 2.000, 400.0000, 8000.00, 10.000, 'MOBILE_MONEY', @queue_suspicious_id, 'UNDER_REVIEW', 'UNCHANGED', 'CONFLICTING_TELEMETRY', 'Telemetry and dispense summary conflict.')
ON DUPLICATE KEY UPDATE
  payment_reference = VALUES(payment_reference),
  authorized_at = VALUES(authorized_at),
  dispensed_at = VALUES(dispensed_at),
  settled_at = VALUES(settled_at),
  litres = VALUES(litres),
  total_amount = VALUES(total_amount),
  requested_litres = VALUES(requested_litres),
  workflow_reason_code = VALUES(workflow_reason_code),
  workflow_note = VALUES(workflow_note);

SET @tx_valid_id := (SELECT id FROM transactions WHERE public_id = 'TXN-RFD-VALID-20260312-0001' LIMIT 1);
SET @tx_invalid_id := (SELECT id FROM transactions WHERE public_id = 'TXN-RFD-INVALID-20260312-0001' LIMIT 1);
SET @tx_suspicious_id := (SELECT id FROM transactions WHERE public_id = 'TXN-RFD-SUSPICIOUS-20260312-0001' LIMIT 1);

INSERT INTO ledger_transactions (
  wallet_id, transaction_reference, external_reference, transaction_type, transaction_status, currency_code,
  gross_amount, net_amount, fee_amount, description, related_entity_type, related_entity_id, initiated_by_user_id, posted_at, metadata_json
) VALUES
(NULL, 'LTX-RFD-VALID-0001', 'TXN-RFD-VALID-20260312-0001', 'RESERVATION_PAYMENT', 'POSTED', 'MWK', 15000.00, 15000.00, 0.00,
 'Reservation payment captured for failed dispense scenario.', 'RESERVATION', 'RSV-RFD-VALID-20260312-0001', @customer_one, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 285 MINUTE),
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-VALID-20260312-0001')),
(NULL, 'LTX-RFD-INVALID-0001', 'TXN-RFD-INVALID-20260312-0001', 'RESERVATION_PAYMENT', 'POSTED', 'MWK', 28000.00, 28000.00, 0.00,
 'Reservation payment captured for completed dispensing scenario.', 'RESERVATION', 'RSV-RFD-INVALID-20260312-0001', @customer_two, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 393 MINUTE),
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-INVALID-20260312-0001')),
(NULL, 'LTX-RFD-SUSPICIOUS-0001', 'TXN-RFD-SUSPICIOUS-20260312-0001', 'RESERVATION_PAYMENT', 'POSTED', 'MWK', 8000.00, 8000.00, 0.00,
 'Reservation payment captured for suspicious conflicting telemetry scenario.', 'RESERVATION', 'RSV-RFD-SUSPICIOUS-20260312-0001', @customer_three, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 518 MINUTE),
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-SUSPICIOUS-20260312-0001'))
ON DUPLICATE KEY UPDATE
  external_reference = VALUES(external_reference),
  net_amount = VALUES(net_amount),
  transaction_status = VALUES(transaction_status),
  posted_at = VALUES(posted_at),
  metadata_json = VALUES(metadata_json);

INSERT INTO pump_sessions (
  public_id, transaction_id, station_id, pump_id, nozzle_id, session_reference, session_status, start_time, end_time,
  dispense_duration_seconds, dispensed_litres, error_code, error_message, telemetry_correlation_id
) VALUES
('01RFP10000000000000000000', @tx_valid_id, @station_valid, @pump_valid, @nozzle_valid, 'PS-RFD-VALID-0001', 'FAILED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 287 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 286 MINUTE),
 60, 0.000, 'FLOW_TIMEOUT', 'Pump authorization timed out before dispensing started.', 'TEL-RFD-VALID-0001'),
('01RFP20000000000000000000', @tx_invalid_id, @station_invalid, @pump_invalid, @nozzle_invalid, 'PS-RFD-INVALID-0001', 'COMPLETED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE),
 90, 35.000, NULL, NULL, 'TEL-RFD-INVALID-0001'),
('01RFP30000000000000000000', @tx_suspicious_id, @station_suspicious, @pump_suspicious, @nozzle_suspicious, 'PS-RFD-SUSPICIOUS-0001', 'FAILED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 521 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE),
 75, 2.000, 'SENSOR_MISMATCH', 'Controller marked failure while flow readings were still reported.', 'TEL-RFD-SUSPICIOUS-0001')
ON DUPLICATE KEY UPDATE
  session_status = VALUES(session_status),
  end_time = VALUES(end_time),
  dispense_duration_seconds = VALUES(dispense_duration_seconds),
  dispensed_litres = VALUES(dispensed_litres),
  error_code = VALUES(error_code),
  error_message = VALUES(error_message),
  telemetry_correlation_id = VALUES(telemetry_correlation_id);

SET @pump_session_valid := (SELECT id FROM pump_sessions WHERE session_reference = 'PS-RFD-VALID-0001' LIMIT 1);
SET @pump_session_invalid := (SELECT id FROM pump_sessions WHERE session_reference = 'PS-RFD-INVALID-0001' LIMIT 1);
SET @pump_session_suspicious := (SELECT id FROM pump_sessions WHERE session_reference = 'PS-RFD-SUSPICIOUS-0001' LIMIT 1);

INSERT INTO pump_telemetry_logs (
  public_id, station_id, pump_id, nozzle_id, pump_session_id, telemetry_correlation_id, event_type, severity,
  litres_value, flow_rate, raw_error_code, message, payload_json, source_type, happened_at, ingested_at
) VALUES
('01RFT10000000000000000000', @station_valid, @pump_valid, @nozzle_valid, @pump_session_valid, 'TEL-RFD-VALID-0001', 'NOZZLE_LIFTED', 'INFO',
 NULL, NULL, NULL, 'Nozzle lifted and session authorized.', JSON_OBJECT('state', 'lifted'), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 287 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 287 MINUTE)),
('01RFT10000000000000000001', @station_valid, @pump_valid, @nozzle_valid, @pump_session_valid, 'TEL-RFD-VALID-0001', 'TIMEOUT', 'HIGH',
 0.000, NULL, 'FLOW_TIMEOUT', 'Pump timed out before flow started.', JSON_OBJECT('errorCode', 'FLOW_TIMEOUT'), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 286 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 286 MINUTE)),

('01RFT20000000000000000000', @station_invalid, @pump_invalid, @nozzle_invalid, @pump_session_invalid, 'TEL-RFD-INVALID-0001', 'NOZZLE_LIFTED', 'INFO',
 NULL, NULL, NULL, 'Nozzle lifted.', JSON_OBJECT('state', 'lifted'), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE)),
('01RFT20000000000000000001', @station_invalid, @pump_invalid, @nozzle_invalid, @pump_session_invalid, 'TEL-RFD-INVALID-0001', 'DISPENSING_STARTED', 'INFO',
 0.000, 1.200, NULL, 'Fuel flow started.', JSON_OBJECT('stage', 'start'), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 396 MINUTE)),
('01RFT20000000000000000002', @station_invalid, @pump_invalid, @nozzle_invalid, @pump_session_invalid, 'TEL-RFD-INVALID-0001', 'FLOW_READING', 'INFO',
 18.400, 1.350, NULL, 'Mid-session flow reading reported.', JSON_OBJECT('litres', 18.4), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE)),
('01RFT20000000000000000003', @station_invalid, @pump_invalid, @nozzle_invalid, @pump_session_invalid, 'TEL-RFD-INVALID-0001', 'DISPENSING_STOPPED', 'INFO',
 35.000, 0.000, NULL, 'Fuel flow stopped normally.', JSON_OBJECT('litres', 35.0), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 395 MINUTE)),

('01RFT30000000000000000000', @station_suspicious, @pump_suspicious, @nozzle_suspicious, @pump_session_suspicious, 'TEL-RFD-SUSPICIOUS-0001', 'FLOW_READING', 'INFO',
 8.000, 1.100, NULL, 'Flow reading reported before controller failure flag.', JSON_OBJECT('litres', 8.0), 'PUMP_CONTROLLER',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE)),
('01RFT30000000000000000001', @station_suspicious, @pump_suspicious, @nozzle_suspicious, @pump_session_suspicious, 'TEL-RFD-SUSPICIOUS-0001', 'ERROR', 'CRITICAL',
 2.000, NULL, 'SENSOR_MISMATCH', 'Telemetry conflict detected between flow meter and controller.', JSON_OBJECT('errorCode', 'SENSOR_MISMATCH'), 'EDGE_GATEWAY',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 520 MINUTE))
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  litres_value = VALUES(litres_value),
  flow_rate = VALUES(flow_rate),
  raw_error_code = VALUES(raw_error_code),
  message = VALUES(message),
  payload_json = VALUES(payload_json),
  happened_at = VALUES(happened_at),
  ingested_at = VALUES(ingested_at);

INSERT INTO compliance_cases (
  public_id, station_id, user_id, category, severity, status, assigned_user_id, summary, action_taken
) VALUES
('01RFC30000000000000000000', @station_suspicious, @customer_three, 'REFUND_INVESTIGATION', 'HIGH', 'INVESTIGATING', @risk_user,
 'Suspicious refund claim with conflicting pump telemetry and repeated refund attempts.', 'Opened from finance refund review because telemetry and session summary conflict.')
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  assigned_user_id = VALUES(assigned_user_id),
  summary = VALUES(summary),
  action_taken = VALUES(action_taken);

SET @compliance_case_suspicious := (SELECT id FROM compliance_cases WHERE public_id = '01RFC30000000000000000000' LIMIT 1);

INSERT INTO refund_requests (
  public_id, station_id, user_id, support_case_id, transaction_id, transaction_public_id, amount_mwk, priority, status,
  investigation_status, review_stage, requested_by_user_id, reviewed_by_user_id, support_reviewed_by_user_id, finance_reviewed_by_user_id,
  reason, refund_reason_code, user_statement, resolution_notes, requested_at, reviewed_at, final_decision_at,
  wallet_transaction_reference, credited_at, compliance_case_id
) VALUES
('01RFR10000000000000000000', @station_valid, @customer_one, NULL, @tx_valid_id, 'TXN-RFD-VALID-20260312-0001', 15000.00, 'HIGH', 'PENDING_SUPPORT_REVIEW',
 'REQUESTED', 'SUPPORT', @customer_one, NULL, NULL, NULL,
 'Charged but no fuel dispensed', 'NO_DISPENSE_AFTER_PAYMENT', 'Payment was captured but the pump never started flowing fuel.',
 'Waiting for support investigation against pump telemetry and session summary.', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 235 MINUTE), NULL, NULL,
 NULL, NULL, NULL),
('01RFR20000000000000000000', @station_invalid, @customer_two, NULL, @tx_invalid_id, 'TXN-RFD-INVALID-20260312-0001', 28000.00, 'CRITICAL', 'PENDING_FINANCE_APPROVAL',
 'UNDER_REVIEW', 'FINANCE', @customer_two, @support_user, @support_user, NULL,
 'Customer claims pump did not dispense correctly', 'PARTIAL_OR_NO_DISPENSE', 'The amount looked too high and the customer disputed the completed payment.',
 'Support forwarded to finance after reviewing the claim and linked transaction.', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 3 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 150 MINUTE), NULL,
 NULL, NULL, NULL),
('01RFR30000000000000000000', @station_suspicious, @customer_three, NULL, @tx_suspicious_id, 'TXN-RFD-SUSPICIOUS-20260312-0001', 8000.00, 'HIGH', 'PENDING_FINANCE_APPROVAL',
 'ESCALATED', 'COMPLIANCE', @customer_three, @finance_user, @support_user, @finance_user,
 'Conflicting telemetry after failed session', 'CONFLICTING_TELEMETRY', 'The customer says nothing was dispensed, but station attendants reported partial fueling.',
 'Escalated to compliance because telemetry conflict and repeated refund behavior indicate elevated risk.', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 140 MINUTE), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 MINUTE), NULL,
 NULL, NULL, @compliance_case_suspicious),
('01RFR39000000000000000000', @station_suspicious, @customer_three, NULL, @tx_suspicious_id, 'TXN-RFD-SUSPICIOUS-20260312-0001', 2000.00, 'MEDIUM', 'REJECTED',
 'REJECTED', 'CLOSED', @customer_three, @support_user, @support_user, NULL,
 'Prior refund attempt for same suspicious chain', 'REPEATED_ATTEMPT', 'Previous smaller refund attempt on the same station pattern.',
 'Prior request rejected after inconsistency review.', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 14 DAY), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 335 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 335 HOUR), NULL, NULL, NULL)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  investigation_status = VALUES(investigation_status),
  review_stage = VALUES(review_stage),
  reviewed_by_user_id = VALUES(reviewed_by_user_id),
  support_reviewed_by_user_id = VALUES(support_reviewed_by_user_id),
  finance_reviewed_by_user_id = VALUES(finance_reviewed_by_user_id),
  resolution_notes = VALUES(resolution_notes),
  compliance_case_id = VALUES(compliance_case_id);

SET @refund_valid_id := (SELECT id FROM refund_requests WHERE public_id = '01RFR10000000000000000000' LIMIT 1);
SET @refund_invalid_id := (SELECT id FROM refund_requests WHERE public_id = '01RFR20000000000000000000' LIMIT 1);
SET @refund_suspicious_id := (SELECT id FROM refund_requests WHERE public_id = '01RFR30000000000000000000' LIMIT 1);

INSERT INTO refund_reviews (
  public_id, refund_request_id, reviewer_user_id, reviewer_role, decision, notes
) VALUES
('01RFV20000000000000000000', @refund_invalid_id, @support_user, 'CUSTOMER_SUPPORT_AGENT', 'ESCALATE_FINANCE',
 'Support linked the completed transaction, but escalated for finance review because of the large amount and customer dispute.'),
('01RFV30000000000000000000', @refund_suspicious_id, @finance_user, 'FINANCE_MANAGER', 'ESCALATE_COMPLIANCE',
 'Finance detected conflicting telemetry, repeated claims, and required compliance intervention.')
ON DUPLICATE KEY UPDATE
  reviewer_role = VALUES(reviewer_role),
  decision = VALUES(decision),
  notes = VALUES(notes);

INSERT INTO refund_evidence (
  public_id, refund_request_id, evidence_type, source_type, source_id, summary, confidence_weight, attached_by_user_id, metadata_json
) VALUES
('01RFE10000000000000000000', @refund_valid_id, 'TRANSACTION_RECORD', 'TRANSACTION', 'TXN-RFD-VALID-20260312-0001',
 'Transaction links the valid refund claim to a payment-captured but zero-dispense event.', 1.00, @support_user,
 JSON_OBJECT('stationPublicId', @station_valid_public)),
('01RFE10000000000000000001', @refund_valid_id, 'PUMP_SESSION', 'PUMP_SESSION', 'PS-RFD-VALID-0001',
 'Pump session failed with zero dispensed litres and controller timeout.', 0.95, @support_user,
 JSON_OBJECT('sessionStatus', 'FAILED', 'dispensedLitres', 0)),
('01RFE10000000000000000002', @refund_valid_id, 'TELEMETRY_ERROR', 'PUMP_TELEMETRY', 'TEL-RFD-VALID-0001',
 'Telemetry shows a timeout before any fuel flow started.', 0.95, @support_user,
 JSON_OBJECT('eventType', 'TIMEOUT')),

('01RFE20000000000000000000', @refund_invalid_id, 'TRANSACTION_RECORD', 'TRANSACTION', 'TXN-RFD-INVALID-20260312-0001',
 'Completed transaction reflects full 35 litres dispensed and settled value.', 1.00, @support_user,
 JSON_OBJECT('stationPublicId', @station_invalid_public)),
('01RFE20000000000000000001', @refund_invalid_id, 'TELEMETRY_DISPENSE_PROOF', 'PUMP_TELEMETRY', 'TEL-RFD-INVALID-0001',
 'Telemetry timeline shows start, flow readings, and normal stop events.', 0.98, @support_user,
 JSON_OBJECT('dispensedLitres', 35.0)),

('01RFE30000000000000000000', @refund_suspicious_id, 'PUMP_SESSION', 'PUMP_SESSION', 'PS-RFD-SUSPICIOUS-0001',
 'Pump session reports failure but still records partial dispensed litres.', 0.90, @finance_user,
 JSON_OBJECT('sessionStatus', 'FAILED', 'dispensedLitres', 2.0)),
('01RFE30000000000000000001', @refund_suspicious_id, 'TELEMETRY_ERROR', 'PUMP_TELEMETRY', 'TEL-RFD-SUSPICIOUS-0001',
 'Telemetry conflict combines live flow readings with a critical controller error.', 0.96, @finance_user,
 JSON_OBJECT('eventType', 'ERROR', 'rawErrorCode', 'SENSOR_MISMATCH')),
('01RFE30000000000000000002', @refund_suspicious_id, 'AUDIT_EVENT', 'INTERNAL_AUDIT', '01RFA30000000000000000000',
 'Audit trail records escalation to compliance because the claim is suspicious.', 0.75, @finance_user,
 JSON_OBJECT('complianceCasePublicId', '01RFC30000000000000000000'))
ON DUPLICATE KEY UPDATE
  summary = VALUES(summary),
  confidence_weight = VALUES(confidence_weight),
  metadata_json = VALUES(metadata_json),
  attached_by_user_id = VALUES(attached_by_user_id);

INSERT INTO internal_audit_log (
  public_id, actor_user_id, actor_role_code, action_type, target_type, target_public_id, summary, severity, metadata
) VALUES
('01RFA10000000000000000000', @customer_one, 'USER', 'REFUND_REQUEST_CREATE', 'REFUND_REQUEST', '01RFR10000000000000000000',
 'Valid refund scenario submitted after payment captured and pump failed.', 'MEDIUM',
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-VALID-20260312-0001', 'scenario', 'VALID')),
('01RFA20000000000000000000', @support_user, 'CUSTOMER_SUPPORT_AGENT', 'REFUND_FORWARD_FINANCE', 'REFUND_REQUEST', '01RFR20000000000000000000',
 'Invalid refund scenario forwarded to finance with completed dispense evidence attached.', 'HIGH',
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-INVALID-20260312-0001', 'scenario', 'INVALID')),
('01RFA30000000000000000000', @finance_user, 'FINANCE_MANAGER', 'REFUND_ESCALATE_COMPLIANCE', 'REFUND_REQUEST', '01RFR30000000000000000000',
 'Suspicious refund scenario escalated to compliance due to conflicting telemetry and repeated attempts.', 'HIGH',
 JSON_OBJECT('transactionPublicId', 'TXN-RFD-SUSPICIOUS-20260312-0001', 'complianceCasePublicId', '01RFC30000000000000000000', 'scenario', 'SUSPICIOUS'))
ON DUPLICATE KEY UPDATE
  summary = VALUES(summary),
  severity = VALUES(severity),
  metadata = VALUES(metadata);
