CREATE TABLE IF NOT EXISTS analytics.superset_sales
(
    order_number UInt32,
    quantity_ordered UInt16,
    price_each Decimal(12, 2),
    order_line_number UInt8,
    sales Decimal(14, 2),
    order_date Date,
    status LowCardinality(String),
    quarter UInt8,
    month UInt8,
    year UInt16,
    product_line LowCardinality(String),
    msrp UInt16,
    product_code LowCardinality(String),
    customer_name String,
    phone String,
    address_line1 String,
    address_line2 String,
    city String,
    state String,
    postal_code String,
    country LowCardinality(String),
    territory LowCardinality(String),
    contact_last_name String,
    contact_first_name String,
    deal_size LowCardinality(String)
)
ENGINE = MergeTree
ORDER BY (order_date, order_number, order_line_number);
