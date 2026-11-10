CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.orders
(
    order_id UInt64,
    ordered_at DateTime,
    customer_region LowCardinality(String),
    product_category LowCardinality(String),
    status LowCardinality(String),
    quantity UInt16,
    revenue Decimal(12, 2)
)
ENGINE = MergeTree
ORDER BY (ordered_at, order_id);

INSERT INTO analytics.orders
    (order_id, ordered_at, customer_region, product_category, status, quantity, revenue)
VALUES
    (1001, '2026-01-08 10:15:00', 'North', 'Hardware', 'paid', 2, 148.00),
    (1002, '2026-01-12 14:40:00', 'South', 'Software', 'paid', 1, 89.00),
    (1003, '2026-02-03 09:05:00', 'North', 'Software', 'paid', 3, 267.00),
    (1004, '2026-02-17 16:25:00', 'East', 'Hardware', 'refunded', 1, 74.00),
    (1005, '2026-03-02 11:20:00', 'West', 'Services', 'paid', 2, 320.00),
    (1006, '2026-03-11 08:50:00', 'South', 'Hardware', 'paid', 4, 296.00),
    (1007, '2026-04-06 13:10:00', 'East', 'Software', 'paid', 2, 178.00),
    (1008, '2026-04-21 17:35:00', 'North', 'Services', 'pending', 1, 160.00),
    (1009, '2026-05-04 10:00:00', 'West', 'Hardware', 'paid', 3, 222.00),
    (1010, '2026-05-22 15:45:00', 'South', 'Services', 'paid', 1, 160.00),
    (1011, '2026-06-09 12:30:00', 'East', 'Hardware', 'paid', 2, 148.00),
    (1012, '2026-06-18 09:55:00', 'West', 'Software', 'paid', 5, 445.00);
