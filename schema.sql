PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producer TEXT NOT NULL,
  wine_name TEXT NOT NULL,
  region TEXT,
  country TEXT,
  appellation TEXT,
  vineyard_or_climat TEXT,
  classification TEXT,
  grape_variety TEXT,
  color TEXT NOT NULL CHECK (color IN ('red','white','sparkling','sweet','fortified')),
  vintage INTEGER,
  bottle_size TEXT DEFAULT '750ml',
  alcohol REAL,
  drinking_window_start INTEGER,
  drinking_window_end INTEGER,
  ideal_price_sgd REAL,
  max_price_sgd REAL,
  current_market_price_sgd REAL,
  personal_priority TEXT DEFAULT 'B' CHECK (personal_priority IN ('A','B','C','Avoid')),
  target_inventory INTEGER DEFAULT 1,
  current_inventory INTEGER DEFAULT 0,
  tasted_before INTEGER DEFAULT 0,
  personal_score REAL,
  portfolio_role_reason TEXT,
  wine_introduction TEXT,
  current_drinking_advice TEXT,
  decanting_advice TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wine_category_tags (
  wine_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Drink Now','Cellar','Business','Discovery')),
  PRIMARY KEY (wine_id, category),
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wine_style_tags (
  wine_id INTEGER NOT NULL,
  style_tag TEXT NOT NULL,
  PRIMARY KEY (wine_id, style_tag),
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  purchase_date TEXT NOT NULL,
  merchant TEXT,
  price_sgd REAL NOT NULL,
  quantity INTEGER NOT NULL,
  tax_included INTEGER DEFAULT 1,
  delivery_fee REAL DEFAULT 0,
  total_cost REAL,
  purchase_reason TEXT,
  source_file_or_link TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tastings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER NOT NULL,
  tasting_date TEXT NOT NULL,
  occasion TEXT,
  decanting_time TEXT,
  serving_temperature TEXT,
  aroma_notes TEXT,
  palate_notes TEXT,
  structure_notes TEXT,
  food_pairing TEXT,
  personal_score REAL,
  would_buy_again TEXT CHECK (would_buy_again IN ('yes','no','maybe')),
  preferred_use_case_after_tasting TEXT,
  tasting_summary TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_name TEXT NOT NULL UNIQUE,
  country TEXT,
  website TEXT,
  notes TEXT,
  reliability_score REAL,
  price_level TEXT,
  delivery_notes TEXT
);

CREATE TABLE IF NOT EXISTS target_portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL UNIQUE,
  target_percentage REAL NOT NULL,
  current_percentage REAL DEFAULT 0,
  target_bottle_count INTEGER DEFAULT 0,
  current_bottle_count INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS producer_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producer TEXT NOT NULL UNIQUE,
  region_group TEXT NOT NULL,
  color_focus TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS buy_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wine_id INTEGER,
  producer TEXT NOT NULL,
  wine_name TEXT NOT NULL,
  recommended_vintages TEXT,
  ideal_price_sgd REAL,
  max_price_sgd REAL,
  current_inventory INTEGER DEFAULT 0,
  target_inventory INTEGER DEFAULT 1,
  recommendation_grade TEXT DEFAULT 'B' CHECK (recommendation_grade IN ('S','A','B','C','Avoid')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS portfolio_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producer TEXT NOT NULL,
  wine_name TEXT NOT NULL,
  region TEXT,
  country TEXT DEFAULT 'France',
  color TEXT NOT NULL CHECK (color IN ('red','white','sparkling','sweet','fortified')),
  recommended_vintages TEXT,
  avoid_vintages TEXT,
  ideal_price_sgd REAL,
  max_price_sgd REAL,
  role TEXT NOT NULL DEFAULT 'Discovery' CHECK (role IN ('Daily Drink','Cellar','Business','Discovery','Heritage')),
  stage TEXT NOT NULL DEFAULT 'Ready' CHECK (stage IN ('Ready','Hold','Long Cellar')),
  status TEXT NOT NULL DEFAULT 'Wishlist' CHECK (status IN ('Wishlist','Purchased','Tasted','Approved','Archived')),
  personal_score REAL,
  would_buy_again TEXT CHECK (would_buy_again IN ('yes','no','maybe')),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (producer, wine_name)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  producer TEXT,
  wine_name TEXT,
  vintage INTEGER,
  region TEXT,
  color TEXT,
  price_sgd REAL,
  target_price_sgd REAL,
  max_price_sgd REAL,
  recommendation_grade TEXT NOT NULL,
  suggested_quantity INTEGER DEFAULT 0,
  reasons TEXT,
  raw_text TEXT,
  FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);
