-- BMC capacity, the report CC-code, and the opening balance the daily stock report starts from.
alter table public.bmcs
  add column if not exists cc_code integer,
  add column if not exists capacity_litres numeric(10,1) check (capacity_litres is null or capacity_litres >= 0);

create table if not exists public.bmc_opening_balances (
  id              bigint generated always as identity primary key,
  id_token        text not null unique check (id_token ~ '^[A-Z]{2}00[A-Z]{4}[0-9]{3}$'),
  bmc_id          bigint not null unique references public.bmcs (id) on delete cascade,
  balance_date    date not null,
  quantity_litres numeric(12,1) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists bmc_opening_balances_id_token on public.bmc_opening_balances;
create trigger bmc_opening_balances_id_token before insert or update on public.bmc_opening_balances
  for each row execute function public.set_id_token('OB');
drop trigger if exists bmc_opening_balances_touch on public.bmc_opening_balances;
create trigger bmc_opening_balances_touch before update on public.bmc_opening_balances
  for each row execute function public.touch_updated_at();
alter table public.bmc_opening_balances enable row level security;

-- Values from BMCs-RECEIPTS-OCT26 (CC-CODE, capacity, opening stock on 01-Oct-2026)
with src(cc_code, name, capacity, ob, team) as (values
  (12,'Vettukadu',2000,726.0,'NKL'),
  (13,'Solakkadu',3000,754.0,'NKL'),
  (29,'Singalandapuram',5500,1777.0,'RPM'),
  (30,'Pillipakuttai',5000,2266.0,'RPM'),
  (31,'Kamarajnagar',5000,2250.0,'RPM'),
  (32,'Vadugam',5000,2311.0,'RPM'),
  (33,'T.kummbakottai',2000,795.0,'RPM'),
  (34,'R.pudupatti',5500,2085.0,'RPM'),
  (38,'Andikuttai',5000,2155.0,'RPM'),
  (41,'Mangalam',5000,2358.0,'T.CODE'),
  (56,'Vepplaikuttai',5000,1758.0,'RPM'),
  (67,'Thanner Pandal Kadu',3000,1200.0,'RPM'),
  (68,'Thimmanaickanpatty',1000,450.0,'RPM'),
  (69,'Udairpalayam',1000,355.0,'RPM'),
  (70,'Moolapallipatty',1000,330.0,'RPM'),
  (72,'Em Palayam',2000,865.0,'RPM'),
  (73,'Vellakkalpatty',1000,360.0,'RPM'),
  (74,'Balanagar',5000,2481.0,'RPM'),
  (75,'Kuttikapalayam',5000,2315.0,'T.CODE'),
  (76,'Ponparapippatty',5000,1905.0,'RPM'),
  (77,'Koonavealam Patty Pudur',5000,1507.0,'RPM'),
  (78,'Thathaiyangerapatty',5000,1951.0,'NKL'),
  (79,'Selliyaeepalayam',5000,2200.0,'NKL'),
  (80,'Akkiyampatty',5000,2048.0,'NKL'),
  (81,'Vagurampatty',5000,2274.0,'NKL'),
  (82,'Veppanathampudur',3000,1421.0,'NKL'),
  (83,'Ariyur',5000,1998.0,'NKL'),
  (84,'Selursellapampalayam',3000,1355.0,'T.CODE'),
  (85,'Pappampalayam',3000,1083.0,'T.CODE'),
  (86,'Vaiyappamalai',5000,2298.0,'T.CODE'),
  (87,'Minnakkal',5000,1926.0,'RPM'),
  (88,'Malayampatty',2000,632.0,'RPM'),
  (89,'Thannerpanthalpalayam',5000,2317.0,'T.CODE'),
  (90,'Kuttamookenpatty',3000,1099.0,'NKL'),
  (91,'Tholur',3000,1250.0,'NKL')
), upd as (
  update public.bmcs b set cc_code = s.cc_code, capacity_litres = s.capacity
    from src s where lower(b.name) = lower(s.name) and b.kind = 'BMC'
  returning b.id, s.ob
)
insert into public.bmc_opening_balances (bmc_id, balance_date, quantity_litres)
select id, date '2026-10-01', ob from upd
on conflict (bmc_id) do nothing;
