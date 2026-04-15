-- 044_seed_promotions_demo.sql
-- Optional demo data for promotions, flash fuel pricing, cashback, and receipt-ready transactions.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @seed_station_id := (
  SELECT id
  FROM stations
  WHERE is_active = 1
  ORDER BY id ASC
  LIMIT 1
);

SET @seed_user_id := (
  SELECT id
  FROM users
  WHERE is_active = 1
  ORDER BY id ASC
  LIMIT 1
);

SET @seed_staff_id := (
  SELECT id
  FROM station_staff
  WHERE station_id = @seed_station_id
    AND is_active = 1
  ORDER BY id ASC
  LIMIT 1
);

SET @petrol_fuel_id := (SELECT id FROM fuel_types WHERE code = 'PETROL' LIMIT 1);
SET @diesel_fuel_id := (SELECT id FROM fuel_types WHERE code = 'DIESEL' LIMIT 1);

SET @petrol_nozzle_id := (
  SELECT pn.id
  FROM pump_nozzles pn
  INNER JOIN fuel_types ft ON ft.id = pn.fuel_type_id
  WHERE pn.station_id = @seed_station_id
    AND pn.is_active = 1
    AND ft.code = 'PETROL'
  ORDER BY pn.id ASC
  LIMIT 1
);

SET @petrol_pump_id := (
  SELECT pn.pump_id
  FROM pump_nozzles pn
  WHERE pn.id = @petrol_nozzle_id
  LIMIT 1
);

SET @diesel_nozzle_id := (
  SELECT pn.id
  FROM pump_nozzles pn
  INNER JOIN fuel_types ft ON ft.id = pn.fuel_type_id
  WHERE pn.station_id = @seed_station_id
    AND pn.is_active = 1
    AND ft.code = 'DIESEL'
  ORDER BY pn.id ASC
  LIMIT 1
);

SET @diesel_pump_id := (
  SELECT pn.pump_id
  FROM pump_nozzles pn
  WHERE pn.id = @diesel_nozzle_id
  LIMIT 1
);

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMOPETROLDISC000001',
  @seed_station_id,
  'Petrol Night Saver',
  'Station-funded forecourt discount for evening petrol sales.',
  'Petrol Night Saver',
  'DISCOUNT',
  @petrol_fuel_id,
  'STATION',
  100.0000,
  0.0000,
  'FIXED_PER_LITRE',
  150.0000,
  NULL,
  NULL,
  'WALLET',
  NULL,
  '2026-03-15 16:00:00.000',
  '2026-03-15 22:00:00.000',
  1,
  'ACTIVE',
  500,
  2500.000,
  0,
  0.000,
  JSON_OBJECT('paymentMethods', JSON_ARRAY('CASH','CARD','MOBILE_MONEY')),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMOPETROLDISC000001');

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMODIESELCASH00002',
  @seed_station_id,
  'Diesel Wallet Cashback',
  'SmartLink-funded cashback for diesel checkouts.',
  'Diesel Wallet Cashback',
  'CASHBACK',
  @diesel_fuel_id,
  'SMARTLINK',
  0.0000,
  100.0000,
  NULL,
  NULL,
  'PERCENTAGE',
  3.0000,
  'WALLET',
  NULL,
  '2026-03-15 06:00:00.000',
  '2026-03-16 23:00:00.000',
  1,
  'ACTIVE',
  800,
  5000.000,
  0,
  0.000,
  JSON_OBJECT('paymentMethods', JSON_ARRAY('CASH','CARD','MOBILE_MONEY')),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMODIESELCASH00002');

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMOFLASHPETROL0003',
  @seed_station_id,
  'Flash Petrol Rush',
  'Shared flash fuel campaign with a visible limited-time petrol price.',
  'Flash Petrol Rush',
  'FLASH_PRICE',
  @petrol_fuel_id,
  'SHARED',
  50.0000,
  50.0000,
  'FLASH_PRICE_PER_LITRE',
  NULL,
  NULL,
  NULL,
  'WALLET',
  4690.0000,
  '2026-03-15 09:00:00.000',
  '2026-03-15 13:00:00.000',
  1,
  'ACTIVE',
  300,
  2000.000,
  0,
  0.000,
  JSON_OBJECT('minLitres', 10),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMOFLASHPETROL0003');

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMOWALLETBOOST0004',
  @seed_station_id,
  'Wallet Boost Cashback',
  'SmartLink cashback layered onto qualifying petrol purchases.',
  'Wallet Boost Cashback',
  'CASHBACK',
  @petrol_fuel_id,
  'SMARTLINK',
  0.0000,
  100.0000,
  NULL,
  NULL,
  'FIXED_AMOUNT',
  3120.0000,
  'WALLET',
  NULL,
  '2026-03-15 08:00:00.000',
  '2026-03-15 23:00:00.000',
  1,
  'ACTIVE',
  500,
  5000.000,
  0,
  0.000,
  JSON_OBJECT('minLitres', 20),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMOWALLETBOOST0004');

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMOSHAREDFLEET0005',
  @seed_station_id,
  'Shared Fleet Basket Relief',
  'Shared fixed-basket relief for diesel fleet fueling.',
  'Fleet Basket Relief',
  'DISCOUNT',
  @diesel_fuel_id,
  'SHARED',
  40.0000,
  60.0000,
  'FIXED_BASKET',
  2500.0000,
  NULL,
  NULL,
  'WALLET',
  NULL,
  '2026-03-15 07:00:00.000',
  '2026-03-16 18:00:00.000',
  1,
  'ACTIVE',
  250,
  3000.000,
  0,
  0.000,
  JSON_OBJECT('minLitres', 20),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMOSHAREDFLEET0005');

INSERT INTO promotion_campaigns (
  public_id, station_id, name, description, campaign_label, promotion_kind, fuel_type_id,
  funding_source, station_share_pct, smartlink_share_pct, discount_mode, discount_value,
  cashback_mode, cashback_value, cashback_destination, flash_price_per_litre,
  starts_at, ends_at, is_active, status, max_redemptions, max_litres, redeemed_count,
  redeemed_litres, eligibility_rules_json, created_by_user_id
)
SELECT
  '01PROMODEMOSCHEDULED000006',
  @seed_station_id,
  'Weekend Diesel Welcome',
  'Scheduled diesel discount to demonstrate future campaigns.',
  'Weekend Diesel Welcome',
  'DISCOUNT',
  @diesel_fuel_id,
  'STATION',
  100.0000,
  0.0000,
  'PERCENTAGE_PER_LITRE',
  4.0000,
  NULL,
  NULL,
  'WALLET',
  NULL,
  '2026-03-21 06:00:00.000',
  '2026-03-22 18:00:00.000',
  1,
  'ACTIVE',
  300,
  2500.000,
  0,
  0.000,
  JSON_OBJECT('daysOfWeek', JSON_ARRAY('SATURDAY','SUNDAY')),
  @seed_user_id
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_campaigns WHERE public_id = '01PROMODEMOSCHEDULED000006');

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, litres, price_per_litre, base_price_per_litre, total_amount, requested_litres, subtotal,
  total_direct_discount, station_discount_total, smartlink_discount_total, cashback_total,
  final_amount_paid, effective_price_per_litre, promo_labels_applied, pricing_snapshot_json,
  receipt_verification_ref, cashback_status, cashback_destination, payment_method, recorded_by_staff_id,
  queue_entry_id, note, status, settlement_impact_status
)
SELECT
  @seed_station_id, '01TXDEMONODISCOUNT000000001', @petrol_pump_id, @petrol_nozzle_id, @seed_user_id, NULL, 'DEMO-NODISC-001', @petrol_fuel_id,
  '2026-03-15 08:10:00.000', 20.000, 4990.0000, 4990.0000, 99800.00, 20.000, 99800.00,
  0.00, 0.00, 0.00, 0.00, 99800.00, 4990.0000, JSON_ARRAY(),
  JSON_OBJECT('basePricePerLitre',4990,'litres',20,'subtotal',99800,'totalDirectDiscount',0,'cashback',0,'finalPayable',99800,'effectivePricePerLitre',4990,'promoLabelsApplied',JSON_ARRAY()),
  'RCPT-DEMONODISC001', 'NONE', 'NONE', 'CASH', @seed_staff_id, NULL,
  'Baseline sale with no promotion applied.', 'RECORDED', 'UNCHANGED'
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE public_id = '01TXDEMONODISCOUNT000000001');

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, litres, price_per_litre, base_price_per_litre, total_amount, requested_litres, subtotal,
  total_direct_discount, station_discount_total, smartlink_discount_total, cashback_total,
  final_amount_paid, effective_price_per_litre, promo_labels_applied, pricing_snapshot_json,
  receipt_verification_ref, cashback_status, cashback_destination, payment_method, recorded_by_staff_id,
  queue_entry_id, note, status, settlement_impact_status
)
SELECT
  @seed_station_id, '01TXDEMODIRECTONLY00000002', @petrol_pump_id, @petrol_nozzle_id, @seed_user_id, NULL, 'DEMO-DIRECT-002', @petrol_fuel_id,
  '2026-03-15 18:20:00.000', 30.000, 4840.0000, 4990.0000, 145200.00, 30.000, 149700.00,
  4500.00, 4500.00, 0.00, 0.00, 145200.00, 4840.0000, JSON_ARRAY('Petrol Night Saver'),
  JSON_OBJECT('basePricePerLitre',4990,'litres',30,'subtotal',149700,'totalDirectDiscount',4500,'cashback',0,'finalPayable',145200,'effectivePricePerLitre',4840,'promoLabelsApplied',JSON_ARRAY('Petrol Night Saver')),
  'RCPT-DEMODIRECT002', 'NONE', 'NONE', 'CARD', @seed_staff_id, NULL,
  'Direct station discount only.', 'RECORDED', 'UNCHANGED'
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE public_id = '01TXDEMODIRECTONLY00000002');

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, litres, price_per_litre, base_price_per_litre, total_amount, requested_litres, subtotal,
  total_direct_discount, station_discount_total, smartlink_discount_total, cashback_total,
  final_amount_paid, effective_price_per_litre, promo_labels_applied, pricing_snapshot_json,
  receipt_verification_ref, cashback_status, cashback_destination, payment_method, recorded_by_staff_id,
  queue_entry_id, note, status, settlement_impact_status
)
SELECT
  @seed_station_id, '01TXDEMOCASHBACKONLY000003', @diesel_pump_id, @diesel_nozzle_id, @seed_user_id, NULL, 'DEMO-CASHBACK-003', @diesel_fuel_id,
  '2026-03-15 09:05:00.000', 40.000, 4820.0000, 4820.0000, 192800.00, 40.000, 192800.00,
  0.00, 0.00, 0.00, 5784.00, 192800.00, 4675.4000, JSON_ARRAY('Diesel Wallet Cashback'),
  JSON_OBJECT('basePricePerLitre',4820,'litres',40,'subtotal',192800,'totalDirectDiscount',0,'cashback',5784,'finalPayable',192800,'effectivePricePerLitre',4675.4,'promoLabelsApplied',JSON_ARRAY('Diesel Wallet Cashback')),
  'RCPT-DEMOCASH003', 'CREDITED', 'WALLET', 'MOBILE_MONEY', @seed_staff_id, NULL,
  'Cashback-only diesel transaction.', 'RECORDED', 'UNCHANGED'
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE public_id = '01TXDEMOCASHBACKONLY000003');

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, litres, price_per_litre, base_price_per_litre, total_amount, requested_litres, subtotal,
  total_direct_discount, station_discount_total, smartlink_discount_total, cashback_total,
  final_amount_paid, effective_price_per_litre, promo_labels_applied, pricing_snapshot_json,
  receipt_verification_ref, cashback_status, cashback_destination, payment_method, recorded_by_staff_id,
  queue_entry_id, note, status, settlement_impact_status
)
SELECT
  @seed_station_id, '01TXDEMOFLASHPLUSCB0000004', @petrol_pump_id, @petrol_nozzle_id, @seed_user_id, NULL, 'DEMO-FLASH-004', @petrol_fuel_id,
  '2026-03-15 10:15:00.000', 35.000, 4690.0000, 4990.0000, 164150.00, 35.000, 174650.00,
  10500.00, 5250.00, 5250.00, 3120.00, 164150.00, 4586.5714, JSON_ARRAY('Flash Petrol Rush','Wallet Boost Cashback'),
  JSON_OBJECT('basePricePerLitre',4990,'litres',35,'subtotal',174650,'totalDirectDiscount',10500,'cashback',3120,'finalPayable',164150,'effectivePricePerLitre',4586.5714,'promoLabelsApplied',JSON_ARRAY('Flash Petrol Rush','Wallet Boost Cashback')),
  'RCPT-DEMOFLASH004', 'CREDITED', 'WALLET', 'CARD', @seed_staff_id, NULL,
  'Flash fuel price plus cashback combined.', 'RECORDED', 'UNCHANGED'
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE public_id = '01TXDEMOFLASHPLUSCB0000004');

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, user_id, reservation_public_id, payment_reference, fuel_type_id,
  occurred_at, litres, price_per_litre, base_price_per_litre, total_amount, requested_litres, subtotal,
  total_direct_discount, station_discount_total, smartlink_discount_total, cashback_total,
  final_amount_paid, effective_price_per_litre, promo_labels_applied, pricing_snapshot_json,
  receipt_verification_ref, cashback_status, cashback_destination, payment_method, recorded_by_staff_id,
  queue_entry_id, note, status, settlement_impact_status
)
SELECT
  @seed_station_id, '01TXDEMOSHAREDFUND00000005', @diesel_pump_id, @diesel_nozzle_id, @seed_user_id, NULL, 'DEMO-SHARED-005', @diesel_fuel_id,
  '2026-03-15 11:45:00.000', 25.000, 4720.0000, 4820.0000, 118000.00, 25.000, 120500.00,
  2500.00, 1000.00, 1500.00, 0.00, 118000.00, 4720.0000, JSON_ARRAY('Fleet Basket Relief'),
  JSON_OBJECT('basePricePerLitre',4820,'litres',25,'subtotal',120500,'totalDirectDiscount',2500,'cashback',0,'finalPayable',118000,'effectivePricePerLitre',4720,'promoLabelsApplied',JSON_ARRAY('Fleet Basket Relief')),
  'RCPT-DEMOSHARED005', 'NONE', 'NONE', 'CASH', @seed_staff_id, NULL,
  'Shared funding direct discount.', 'RECORDED', 'UNCHANGED'
FROM DUAL
WHERE @seed_station_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE public_id = '01TXDEMOSHAREDFUND00000005');

SET @tx_direct_id := (SELECT id FROM transactions WHERE public_id = '01TXDEMODIRECTONLY00000002' LIMIT 1);
SET @tx_cashback_id := (SELECT id FROM transactions WHERE public_id = '01TXDEMOCASHBACKONLY000003' LIMIT 1);
SET @tx_flash_combo_id := (SELECT id FROM transactions WHERE public_id = '01TXDEMOFLASHPLUSCB0000004' LIMIT 1);
SET @tx_shared_id := (SELECT id FROM transactions WHERE public_id = '01TXDEMOSHAREDFUND00000005' LIMIT 1);

SET @campaign_petrol_discount_id := (SELECT id FROM promotion_campaigns WHERE public_id = '01PROMODEMOPETROLDISC000001' LIMIT 1);
SET @campaign_diesel_cashback_id := (SELECT id FROM promotion_campaigns WHERE public_id = '01PROMODEMODIESELCASH00002' LIMIT 1);
SET @campaign_flash_petrol_id := (SELECT id FROM promotion_campaigns WHERE public_id = '01PROMODEMOFLASHPETROL0003' LIMIT 1);
SET @campaign_wallet_boost_id := (SELECT id FROM promotion_campaigns WHERE public_id = '01PROMODEMOWALLETBOOST0004' LIMIT 1);
SET @campaign_shared_fleet_id := (SELECT id FROM promotion_campaigns WHERE public_id = '01PROMODEMOSHAREDFLEET0005' LIMIT 1);

INSERT INTO promotion_redemptions (
  public_id, transaction_id, campaign_id, user_id, litres_covered, direct_discount_amount,
  cashback_amount, station_funded_amount, smartlink_funded_amount, cashback_status,
  cashback_destination, cashback_credited_at, snapshot_json
)
SELECT
  '01REDDEMODIRECTONLY00000001', @tx_direct_id, @campaign_petrol_discount_id, @seed_user_id, 30.000, 4500.00,
  0.00, 4500.00, 0.00, 'NONE', 'NONE', NULL,
  JSON_OBJECT('campaignLabel','Petrol Night Saver','directDiscountAmount',4500,'cashbackAmount',0)
FROM DUAL
WHERE @tx_direct_id IS NOT NULL
  AND @campaign_petrol_discount_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions WHERE public_id = '01REDDEMODIRECTONLY00000001');

INSERT INTO promotion_redemptions (
  public_id, transaction_id, campaign_id, user_id, litres_covered, direct_discount_amount,
  cashback_amount, station_funded_amount, smartlink_funded_amount, cashback_status,
  cashback_destination, cashback_credited_at, snapshot_json
)
SELECT
  '01REDDEMOCASHBACKONLY000002', @tx_cashback_id, @campaign_diesel_cashback_id, @seed_user_id, 40.000, 0.00,
  5784.00, 0.00, 5784.00, 'CREDITED', 'WALLET', '2026-03-15 09:10:00.000',
  JSON_OBJECT('campaignLabel','Diesel Wallet Cashback','directDiscountAmount',0,'cashbackAmount',5784)
FROM DUAL
WHERE @tx_cashback_id IS NOT NULL
  AND @campaign_diesel_cashback_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions WHERE public_id = '01REDDEMOCASHBACKONLY000002');

INSERT INTO promotion_redemptions (
  public_id, transaction_id, campaign_id, user_id, litres_covered, direct_discount_amount,
  cashback_amount, station_funded_amount, smartlink_funded_amount, cashback_status,
  cashback_destination, cashback_credited_at, snapshot_json
)
SELECT
  '01REDDEMOFLASHCOMBO00000003', @tx_flash_combo_id, @campaign_flash_petrol_id, @seed_user_id, 35.000, 10500.00,
  0.00, 5250.00, 5250.00, 'NONE', 'NONE', NULL,
  JSON_OBJECT('campaignLabel','Flash Petrol Rush','directDiscountAmount',10500,'cashbackAmount',0)
FROM DUAL
WHERE @tx_flash_combo_id IS NOT NULL
  AND @campaign_flash_petrol_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions WHERE public_id = '01REDDEMOFLASHCOMBO00000003');

INSERT INTO promotion_redemptions (
  public_id, transaction_id, campaign_id, user_id, litres_covered, direct_discount_amount,
  cashback_amount, station_funded_amount, smartlink_funded_amount, cashback_status,
  cashback_destination, cashback_credited_at, snapshot_json
)
SELECT
  '01REDDEMOWALLETBOOST0000004', @tx_flash_combo_id, @campaign_wallet_boost_id, @seed_user_id, 35.000, 0.00,
  3120.00, 0.00, 3120.00, 'CREDITED', 'WALLET', '2026-03-15 10:20:00.000',
  JSON_OBJECT('campaignLabel','Wallet Boost Cashback','directDiscountAmount',0,'cashbackAmount',3120)
FROM DUAL
WHERE @tx_flash_combo_id IS NOT NULL
  AND @campaign_wallet_boost_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions WHERE public_id = '01REDDEMOWALLETBOOST0000004');

INSERT INTO promotion_redemptions (
  public_id, transaction_id, campaign_id, user_id, litres_covered, direct_discount_amount,
  cashback_amount, station_funded_amount, smartlink_funded_amount, cashback_status,
  cashback_destination, cashback_credited_at, snapshot_json
)
SELECT
  '01REDDEMOSHAREDFUND00000005', @tx_shared_id, @campaign_shared_fleet_id, @seed_user_id, 25.000, 2500.00,
  0.00, 1000.00, 1500.00, 'NONE', 'NONE', NULL,
  JSON_OBJECT('campaignLabel','Fleet Basket Relief','directDiscountAmount',2500,'cashbackAmount',0)
FROM DUAL
WHERE @tx_shared_id IS NOT NULL
  AND @campaign_shared_fleet_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM promotion_redemptions WHERE public_id = '01REDDEMOSHAREDFUND00000005');
