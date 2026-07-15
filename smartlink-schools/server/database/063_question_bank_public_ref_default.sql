-- Keep question creation compatible across every application write path.
-- Application code supplies UUID() explicitly; this default also protects
-- deployed or integration code that omits the public reference.
ALTER TABLE question_bank
  MODIFY COLUMN public_ref CHAR(36) NOT NULL DEFAULT (UUID());
