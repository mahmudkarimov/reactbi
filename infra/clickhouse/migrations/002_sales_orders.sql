CREATE TABLE IF NOT EXISTS analytics.sales_orders
(
    order_id UInt64,
    ordered_at DateTime,
    customer_id UInt32,
    customer_segment LowCardinality(String),
    customer_region LowCardinality(String),
    sales_channel LowCardinality(String),
    product_category LowCardinality(String),
    product_name LowCardinality(String),
    status LowCardinality(String),
    quantity UInt16,
    unit_price Decimal(12, 2),
    discount_pct Decimal(5, 2),
    revenue Decimal(14, 2),
    cost Decimal(14, 2),
    profit Decimal(14, 2)
)
ENGINE = MergeTree
ORDER BY (ordered_at, order_id);
