-- Patch: Registered Tankers Schema
create table if not exists registered_tankers (
  id text primary key,
  vehicle_number text not null unique,
  contractor_name text not null,
  from_date date not null default current_date,
  vehicle_type text not null default 'Registered' check (vehicle_type in ('Registered', 'Unregistered')),
  number_of_cells int not null default 2 check (number_of_cells in (1, 2, 3)),
  front_cell_capacity numeric not null default 0,
  middle_cell_capacity numeric default 0,
  back_cell_capacity numeric default 0,
  supplier_name text not null,
  created_at timestamptz not null default now()
);

-- Pre-seed standard registered tankers
insert into registered_tankers (id, vehicle_number, contractor_name, from_date, vehicle_type, number_of_cells, front_cell_capacity, middle_cell_capacity, back_cell_capacity, supplier_name)
values
  ('t-reg-1', 'TN28BF9717', 'Murugan Transport', '2026-01-01', 'Registered', 2, 6500, 0, 5500, 'Krishnampudur CC'),
  ('t-reg-2', 'TN54J9599', 'Selvam Logistics', '2026-02-15', 'Registered', 2, 6000, 0, 5000, 'Mallur Vadakadu BMC'),
  ('t-reg-3', 'TN28BJ1697', 'Kongu Dairy Express', '2026-03-10', 'Registered', 2, 7000, 0, 6000, 'Vanavasi BMC'),
  ('t-reg-4', 'TN69AX2529', 'Raman Carriers', '2026-04-01', 'Registered', 3, 4500, 4500, 4500, 'Ariyanoor BMC')
on conflict (vehicle_number) do nothing;
