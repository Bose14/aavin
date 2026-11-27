import { z } from 'zod';

const text = (max = 200) => z.string().max(max);
const optText = (max = 200) => text(max).nullish();
const numLike = z.union([z.number(), z.string().max(30)]).nullish();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const createUserSchema = z.object({
  full_name: text(120),
  email: text(254),
  phone: optText(30),
  team: optText(20),
  team_id: optText(40),
  bmc_id: optText(40),
  shift: optText(20),
  sub_role: optText(20),
  password: optText(128),
  force_password_change: z.boolean().optional(),
}).passthrough();

export const updateUserSchema = z.object({
  full_name: optText(120),
  email: optText(254),
  phone: optText(30),
  team: optText(20),
  team_id: optText(40),
  bmc_id: optText(40),
  shift: optText(20),
  sub_role: optText(20),
  is_active: z.boolean().optional(),
}).passthrough();

export const bmcSchema = z.object({
  name: optText(120),
  bmc_code: optText(40),
  location: optText(200),
  route_name: optText(120),
  team_name: optText(120),
  kind: optText(5),
  code_no: numLike,
  cc_code: numLike,
  capacity_litres: numLike,
  opening_balance: numLike,
  opening_balance_date: isoDate.nullish(),
  milk_type: optText(10),
  is_active: z.boolean().optional(),
  first_user: z.object({
    full_name: optText(120),
    email: optText(254),
    phone: optText(30),
    shift: optText(20),
  }).nullish(),
}).passthrough();

export const milkEntrySchema = z.object({
  date: isoDate.optional(),
  shift: z.enum(['AM', 'PM']).optional(),
  bmc_id: z.union([z.string().max(40), z.number()]).nullish(),
  fat_pct: numLike,
  snf_pct: numLike,
  quantity_litres: numLike,
  rejection_qty: numLike,
  rejection_reason: optText(300),
  temperature: numLike,
  dispatch_date: isoDate.nullish(),
  rate_per_litre: numLike,
  rate_override: z.boolean().optional(),
  rate_override_reason: optText(300),
}).passthrough();
