import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { supplierSuggestions } from "@/lib/expenses";
import { financialYearsInData } from "@/lib/reports";
import { currentFy, todayInTz } from "@/lib/fy";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";

/** One bootstrap call for every form: categories, payment methods, settings,
 * FY thresholds, supplier autofill suggestions and FY list. */
export const GET = api(async () => {
  const d = await db();
  const [categories, paymentMethods, thresholds, settings, suppliers, fys] = await Promise.all([
    d.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name)),
    d.select().from(schema.paymentMethods).orderBy(asc(schema.paymentMethods.sortOrder), asc(schema.paymentMethods.name)),
    d.select().from(schema.fyThresholds).orderBy(asc(schema.fyThresholds.fyLabel)),
    getSettings(),
    supplierSuggestions(),
    financialYearsInData(),
  ]);
  const fy = currentFy();
  return json({
    categories,
    paymentMethods,
    thresholds,
    settings,
    suppliers,
    financialYears: fys.includes(fy) ? fys : [fy, ...fys],
    currentFy: fy,
    today: todayInTz(),
  });
});
