/**
 * First-pass triage of statement lines.
 *
 * The point is to get the obviously-personal noise out of the way — groceries,
 * rent, transit, takeaway — so what remains is the small set that might actually
 * belong in the books. Every call is a suggestion the owner can override; the
 * rules deliberately stay conservative and say "unsure" rather than guess.
 *
 * A merchant that could plausibly be either (Amazon, eBay, Temu, Apple, PayPal)
 * is never auto-classified, because those are exactly where business purchases hide.
 */

export type Verdict = "personal" | "internal" | "unsure";

export type Rule = { label: string; verdict: Verdict; test: RegExp };

/**
 * The owner's own money moving around, plus the mechanics of running the
 * accounts: saver transfers, card repayments, card fees and interest, nil-value
 * verification holds, reversals. Nothing here is spending or income.
 *
 * Money from or to ANOTHER person is deliberately not in this list — that is
 * either personal or something that needs a decision.
 */
const INTERNAL: Rule[] = [
  // Named against the owner's actual savers so "Transfer from <someone else>" is not swept up here.
  { label: "Transfer between own accounts", verdict: "internal", test: /\b(transfer|forward(ed)?|move[dsr]?)\b[^|]{0,24}\b(savings|saver|safety|travel fund|spending)\b|\bround ?up\b|\bcover spending\b|\bbank@post deposit\b/i },
  { label: "Card repayment", verdict: "internal", test: /\b(qantas credit cards|bpay to: qantas|card payment thank ?you|payment received - thank you)\b/i },
  { label: "Own transfer", verdict: "internal", test: /\b(l ?b ?leslie|liam ?b(ranson)? ?leslie|liam leslie|wise australia pty)\b/i },
  { label: "ATO refund", verdict: "internal", test: /\bATO\d{9,}|\bATO\b.*direct credit/i },
  { label: "Card verification — no money moved", verdict: "internal", test: /\bcard checked\b|\btemporary hold\b|\bpre-?auth(orisation)?\b/i },
  { label: "Card fee or interest", verdict: "internal", test: /\b(international transaction fee|intl transaction fee|atm operator fee|annual fee|late payment fee|interest charged|instalment plan interest|cash advance fee|overlimit|monthly fee|account fee)/i },
  { label: "Dishonoured or reversed", verdict: "internal", test: /\b(dishonour|de dishonour|reversal|chargeback)\b/i },
];

/** Everyday private spending. Ordered most specific first. */
const PERSONAL: Rule[] = [
  { label: "Groceries", verdict: "personal", test: /\b(franprix|monoprix|intermarche|leclerc|toko |warung|munggu|mini ?mart|minimart|relay\b|newsagent|tesco|sainsbury|aldi|lidl|coles|woolworths|co ?-? ?op|iceland|asda|morrisons|waitrose|marks ?& ?spencer|amazon fresh|alfamart|indomaret|minimart|circle ?k|7-? ?eleven|spar\b|carrefour|biedronka|zabka|penny|rewe|edeka|migros|coop\b)/i },
  { label: "Takeaway or delivery", verdict: "personal", test: /\b(doordash|dd ?\*|deliveroo|uber ?eats|just ?eat|menulog|glovo|foodpanda|grabfood|gojek ?food)/i },
  { label: "Eating out", verdict: "personal", test: /\b(mcdonald|kfc|burger king|subway\d*|chipotle|starbucks|costa coffee|pret|nando|dominos|pizza|cafe|caffe|coffee|restaurant|restauracja|bistro|kebab|sushi|taco|noodle|ramen|bakery|patisserie|brewery|pub\b|bar\b|tst\*|sq ?\*|zettle_?\*|toast ?tab)/i },
  { label: "Public transport", verdict: "personal", test: /\b(tfl|transport for london|mta ?\*|nyct|path tapp|oyster|trainline|irish ?rail|sbb|cff|ffs|db vertrieb|deutsche bahn|flixbus|hvv|omio|eurail|interrail|metro\b|tram|bus ?eireann|translink|idf ?mobilit|sncf|mycicero|mobilita|ratp|renfe|trenitalia|italo)/i },
  { label: "Rideshare or taxi", verdict: "personal", test: /\b(uber(?! ?eats)|lyft|bolt\.eu|ola cabs|grab\b|gojek|gopay|lime|bird|voi|tier|beryl|santander cycle|cycle hire|humanforest|human forest|freenow|cabify)/i },
  { label: "Accommodation", verdict: "personal", test: /\b(hostel|hostelworld|booking\.com|bkg ?\*|airbnb|safestay|backpack|a&o hotel|balmers|alplodge|generator|st ?christopher|premier inn|travelodge|selina)/i },
  { label: "Rent or housing", verdict: "personal", test: /\b(rent\b|spareroom|deposit\/rent|room ?go|flatshare|council tax)/i },
  { label: "Entertainment", verdict: "personal", test: /\b(netflix|spotify|disney|prime video|cinema|imax|viagogo|ticketmaster|dice\.fm|eventbrite|steam ?games|playstation|xbox|nintendo)/i },
  { label: "Health and personal care", verdict: "personal", test: /\b(pharmacy|chemist|boots\b|superdrug|priceline|dentist|doctor|clinic|optical|specsavers|barber|hairdress|whitepouches|nicotine)/i },
  { label: "Clothing and general retail", verdict: "personal", test: /\b(primark|adidas|nike\b|uniqlo|zara|h&m|asos|david jones|myer|kmart|big ?w|target aus|decathlon|sports ?direct|tk ?maxx)/i },
  { label: "Fuel", verdict: "personal", test: /\b(united petroleum|bp connect|caltex|ampol|shell\b|7-eleven fuel|migrol|circle ?k fuel|petrol)/i },
  { label: "Days out", verdict: "personal", test: /\b(mini golf|kart track|adh entertainment|theme park|zoo\b|aquarium|museum|gallery|bowling|escape room|liberty cruise)/i },
  { label: "Family transfer", verdict: "personal", test: /\b(solomon leslie|elizabeth leslie|simone m leslie|david malcom leslie|david leslie)\b/i },
  { label: "Cash withdrawal", verdict: "personal", test: /\b(atm|cash out|cash advance|international atm)/i },
];

/**
 * Merchants that sell both business and personal goods. Never auto-classified —
 * a standing desk and a set of bed sheets look identical on a statement.
 */
const AMBIGUOUS = /\b(amazon(?![ ./]?fresh)|ebay|temu|aliexpress|apple\b|apple\.com|paypal|afterpay|klarna|zip ?pay|officeworks|jb ?hi-?fi|harvey norman|bunnings|catch\.com|kogan(?! mobile)|wish\.com|etsy)\b/i;

export type Classification = { verdict: Verdict; label: string | null; rule: string | null };

export function classify(text: string): Classification {
  const s = (text || "").trim();
  if (!s) return { verdict: "unsure", label: null, rule: null };

  // A nil-value card check is settled by the fact it moved no money, whoever the
  // merchant is — "Card checked — Apple" must not fall through to the ambiguous list.
  const check = INTERNAL.find((r) => r.label.startsWith("Card verification"))!;
  if (check.test.test(s)) return { verdict: "internal", label: check.label, rule: "card-check" };

  // Otherwise ambiguous retailers win: they are where business buys hide.
  if (AMBIGUOUS.test(s)) return { verdict: "unsure", label: null, rule: "ambiguous-retailer" };

  for (const r of INTERNAL) if (r.test.test(s)) return { verdict: "internal", label: r.label, rule: r.test.source.slice(0, 40) };
  for (const r of PERSONAL) if (r.test.test(s)) return { verdict: "personal", label: r.label, rule: r.test.source.slice(0, 40) };
  return { verdict: "unsure", label: null, rule: null };
}

/**
 * Loose merchant comparison for match confirmation: do the statement text and a
 * supplier name share a distinctive word? Guards the date+amount matcher against
 * coincidences — a $40 lunch and a $40 software invoice four days apart.
 */
const STOP = new Set([
  "the", "and", "ltd", "limited", "pty", "inc", "llc", "com", "co", "au", "pl", "gmbh", "bv", "sa",
  "payment", "purchase", "international", "card", "transaction", "online", "www", "http", "https",
  "subscription", "invoice", "services", "service", "group", "holdings", "australia", "sydney", "melbourne",
]);

export function nameTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w))
  );
}

export function namesLookAlike(statementText: string, supplier: string): boolean {
  const a = nameTokens(statementText);
  const b = nameTokens(supplier);
  if (a.size === 0 || b.size === 0) return false;
  for (const w of b) {
    if (a.has(w)) return true;
    // catch adobe/adobe.ly, google/google*workspace, eleven/elevenlabs
    for (const x of a) if (x.length >= 5 && (x.startsWith(w) || w.startsWith(x))) return true;
  }
  return false;
}
