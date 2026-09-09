-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260605114417  name: 066_b2b_tariff_2025
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

DELETE FROM public.mpesa_b2c_charge_tiers WHERE charge_type = 'b2b';

INSERT INTO public.mpesa_b2c_charge_tiers (charge_type, min_amount, max_amount, charge, notes) VALUES
('b2b',        0,        49,   2, 'Safaricom B2B tariff 2025'),
('b2b',       49,       100,   3, 'Safaricom B2B tariff 2025'),
('b2b',      100,       500,   8, 'Safaricom B2B tariff 2025'),
('b2b',      500,      1000,  13, 'Safaricom B2B tariff 2025'),
('b2b',     1000,      1500,  18, 'Safaricom B2B tariff 2025'),
('b2b',     1500,      2500,  25, 'Safaricom B2B tariff 2025'),
('b2b',     2500,      3500,  30, 'Safaricom B2B tariff 2025'),
('b2b',     3500,      5000,  39, 'Safaricom B2B tariff 2025'),
('b2b',     5000,      7500,  48, 'Safaricom B2B tariff 2025'),
('b2b',     7500,     10000,  54, 'Safaricom B2B tariff 2025'),
('b2b',    10000,     15000,  63, 'Safaricom B2B tariff 2025'),
('b2b',    15000,     20000,  68, 'Safaricom B2B tariff 2025'),
('b2b',    20000,     25000,  74, 'Safaricom B2B tariff 2025'),
('b2b',    25000,     30000,  79, 'Safaricom B2B tariff 2025'),
('b2b',    30000,     35000,  90, 'Safaricom B2B tariff 2025'),
('b2b',    35000,     40000, 106, 'Safaricom B2B tariff 2025'),
('b2b',    40000,     45000, 110, 'Safaricom B2B tariff 2025'),
('b2b',    45000,     50000, 115, 'Safaricom B2B tariff 2025'),
('b2b',    50000,     70000, 115, 'Safaricom B2B tariff 2025'),
('b2b',    70000,    150000, 115, 'Safaricom B2B tariff 2025'),
('b2b',   150000,    250000, 115, 'Safaricom B2B tariff 2025'),
('b2b',   250000,    500000, 115, 'Safaricom B2B tariff 2025'),
('b2b',   500000,   1000000, 115, 'Safaricom B2B tariff 2025'),
('b2b',  1000000,   3000000, 115, 'Safaricom B2B tariff 2025'),
('b2b',  3000000,   5000000, 115, 'Safaricom B2B tariff 2025'),
('b2b',  5000000,  20000000, 115, 'Safaricom B2B tariff 2025'),
('b2b', 20000000,  50000000, 115, 'Safaricom B2B tariff 2025');
