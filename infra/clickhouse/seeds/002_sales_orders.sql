INSERT INTO analytics.sales_orders
SELECT
    order_id,
    ordered_at,
    customer_id,
    customer_segment,
    customer_region,
    sales_channel,
    product_category,
    product_name,
    status,
    quantity,
    unit_price,
    discount_pct,
    toDecimal64(round(quantity * toFloat64(unit_price) * (1 - toFloat64(discount_pct) / 100), 2), 2) AS revenue,
    toDecimal64(round(quantity * toFloat64(unit_price) * 0.58, 2), 2) AS cost,
    toDecimal64(round(quantity * toFloat64(unit_price) * ((1 - toFloat64(discount_pct) / 100) - 0.58), 2), 2) AS profit
FROM
(
    SELECT
        number + 2000 AS order_id,
        toDateTime('2024-01-01 00:00:00') + toIntervalHour(number * 18) AS ordered_at,
        toUInt32(number * 17 % 450 + 1) AS customer_id,
        arrayElement(['Consumer', 'Small Business', 'Mid-Market', 'Enterprise'], number % 4 + 1) AS customer_segment,
        arrayElement(['North', 'South', 'East', 'West', 'Central'], number * 7 % 5 + 1) AS customer_region,
        arrayElement(['Online', 'Retail', 'Partner', 'Direct'], number * 3 % 4 + 1) AS sales_channel,
        number % 12 + 1 AS product_key,
        multiIf(product_key <= 3, 'Software', product_key <= 6, 'Services', product_key <= 9, 'Hardware', product_key <= 11, 'Accessories', 'Subscriptions') AS product_category,
        arrayElement(['Cloud Starter', 'Cloud Pro', 'Analytics Suite', 'Implementation Day', 'Advisory Session', 'Premium Support', 'Workstation', 'Sensor Kit', 'Docking Station', 'Travel Case', 'Adapter Pack', 'Data Subscription'], product_key) AS product_name,
        multiIf(number % 41 = 0, 'refunded', number % 29 = 0, 'cancelled', number % 17 = 0, 'pending', 'paid') AS status,
        toUInt16(number % 8 + 1) AS quantity,
        toDecimal64(multiIf(product_category = 'Software', 99 + number % 600, product_category = 'Services', 250 + number % 750, product_category = 'Hardware', 80 + number % 700, product_category = 'Accessories', 20 + number % 100, 49 + number % 150), 2) AS unit_price,
        toDecimal64(multiIf(number % 4 = 0, 15, number % 3 = 0, 10, number % 2 = 0, 5, 0), 2) AS discount_pct
    FROM numbers(1600)
);
