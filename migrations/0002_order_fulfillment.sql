ALTER TABLE wines ADD COLUMN on_order_inventory INTEGER NOT NULL DEFAULT 0;

ALTER TABLE purchases ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'delivered';
ALTER TABLE purchases ADD COLUMN estimated_delivery_date TEXT;
ALTER TABLE purchases ADD COLUMN delivered_date TEXT;
