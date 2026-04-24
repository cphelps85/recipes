const PARSE_PROMPT = `Parse this recipe and return ONLY a valid JSON object with this exact structure, no other text, no markdown:
{
  "title": "Recipe Title",
  "desc": "One sentence description of the dish",
  "tags": ["beef"],
  "servings": 4,
  "ingredients": [
    { "name": "Ingredient name", "amount": 1, "unit": "cup" }
  ],
  "steps": [
    { "title": "Step title", "text": "Full step description" }
  ],
  "notes": "Any tips or notes, or empty string if none"
}

Rules:
- tags must only use these values: beef, chicken, pork, veggie, quick, lowsodium, slowcooker, kidapproved, special, seafood
- amount must be a number (use 0 if no amount specified)
- unit can be empty string if no unit
- Return ONLY the JSON object, absolutely nothing else`;

// ── Unit conversion to grams ──────────────────────────────────────────
const UNIT_TO_GRAMS = {
  'tbsp': 15, 'tablespoon': 15, 'tablespoons': 15,
  'tsp': 5, 'teaspoon': 5, 'teaspoons': 5,
  'oz': 28, 'ounce': 28, 'ounces': 28,
  'lb': 454, 'pound': 454, 'pounds': 454,
  'g': 1, 'gram': 1, 'grams': 1,
  'kg': 1000,
  'ml': 1, 'mL': 1,
  'l': 1000, 'L': 1000,
  'slice': 30, 'slices': 30,
  'clove': 5, 'cloves': 5,
  'piece': 50, 'pieces': 50,
  'whole': 100,
  '': 100,
};

// Ingredient-specific cup weights (grams per cup) for common dry/dense ingredients
// Default liquid cup = 240g; dry ingredients are much lighter
const CUP_WEIGHTS = {
  // Dry / grain
  'breadcrumb': 110, 'breadcrumbs': 110,
  'flour': 120, 'all-purpose flour': 120, 'whole wheat flour': 120,
  'oat': 90, 'oats': 90, 'rolled oats': 85,
  'rice': 185, 'cooked rice': 185, 'uncooked rice': 200,
  'pasta': 100, 'spaghetti': 100,
  'quinoa': 170,
  'cornmeal': 155,
  'panko': 60, 'panko breadcrumbs': 60,
  // Sugar / sweetener
  'sugar': 200, 'granulated sugar': 200, 'brown sugar': 220,
  'powdered sugar': 120, 'confectioners sugar': 120,
  'honey': 340,
  // Dairy / semi-liquid
  'shredded cheese': 115, 'cheddar': 115, 'mozzarella': 115, 'parmesan': 100,
  'sour cream': 240, 'yogurt': 245, 'cream cheese': 230,
  // Nuts / seeds
  'almond': 140, 'almonds': 140, 'walnut': 120, 'walnuts': 120,
  'pecan': 110, 'pecans': 110, 'cashew': 130, 'cashews': 130,
  'peanut': 140, 'peanuts': 140,
  // Vegetables (chopped/shredded)
  'lettuce': 55, 'shredded lettuce': 55, 'spinach': 30,
  'cabbage': 90, 'shredded cabbage': 90,
  'onion': 160, 'chopped onion': 160,
  'mushroom': 70, 'mushrooms': 70,
  // Beans / legumes
  'bean': 180, 'beans': 180, 'lentil': 190, 'lentils': 190,
  'chickpea': 200, 'chickpeas': 200,
};

function toGrams(amount, unit, ingredientName) {
  const u = unit?.toLowerCase() ?? '';
  if (u === 'cup' || u === 'cups') {
    // Look for a known density match by ingredient name keywords
    const nameLower = (ingredientName || '').toLowerCase();
    for (const [key, weight] of Object.entries(CUP_WEIGHTS)) {
      if (nameLower.includes(key)) return amount * weight;
    }
    return amount * 240; // default: treat as liquid
  }
  const factor = UNIT_TO_GRAMS[u] ?? 100;
  return amount * factor;
}

// ── USDA lookup for one ingredient ───────────────────────────────────
async function lookupUSDA(ingredientName, apiKey) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(ingredientName)}&dataType=SR%20Legacy,Foundation&pageSize=1&api_key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const food = data.foods?.[0];
  if (!food) return null;

  // Match by nutrientNumber (stable USDA IDs) to avoid kJ vs kcal confusion
  const byNum = (num) => food.foodNutrients?.find(n => String(n.nutrientNumber) === num);
  const byName = (str) => food.foodNutrients?.find(n => n.nutrientName?.toLowerCase().includes(str));

  return {
    calories:    byNum('208')?.value ?? byName('energy')?.value ?? 0, // 208 = Energy kcal only
    totalCarbs:  byNum('205')?.value ?? byName('carbohydrate')?.value ?? 0,
    fiber:       byNum('291')?.value ?? byName('fiber')?.value ?? 0,
    addedSugar:  byNum('539')?.value ?? 0, // not in SR Legacy — will be 0 for most whole foods
    totalSugars: byNum('269')?.value ?? byName('sugars')?.value ?? 0,
    protein:     byNum('203')?.value ?? byName('protein')?.value ?? 0,
    totalFat:    byNum('204')?.value ?? byName('total lipid')?.value ?? 0,
    per100g: true,
  };
}

// ── Open Food Facts fallback ──────────────────────────────────────────
async function lookupOFF(ingredientName) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(ingredientName)}&search_simple=1&action=process&json=1&page_size=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const product = data.products?.[0]?.nutriments;
  if (!product) return null;
  return {
    calories:    product['energy-kcal_100g'] ?? 0,
    totalCarbs:  product['carbohydrates_100g'] ?? 0,
    fiber:       product['fiber_100g'] ?? 0,
    addedSugar:  product['sugars_100g'] ?? 0,
    totalSugars: product['sugars_100g'] ?? 0,
    protein:     product['proteins_100g'] ?? 0,
    totalFat:    product['fat_100g'] ?? 0,
    per100g: true,
  };
}

// ── Aggregate nutrition across all ingredients ────────────────────────
async function calculateNutrition(ingredients, servings, usdaKey, anthropicKey, recipeTitle) {
  const totals = { calories:0, totalCarbs:0, fiber:0, addedSugar:0, protein:0, totalFat:0 };

  for (const ing of ingredients) {
    if (!ing.name) continue;
    const grams = toGrams(ing.amount || 1, ing.unit || '', ing.name);
    let nutrients = await lookupUSDA(ing.name, usdaKey);
    if (!nutrients) nutrients = await lookupOFF(ing.name);
    if (!nutrients) continue;

    // nutrients are per 100g — scale to actual grams used
    const scale = grams / 100;
    totals.calories   += nutrients.calories   * scale;
    totals.totalCarbs += nutrients.totalCarbs * scale;
    totals.fiber      += nutrients.fiber      * scale;
    totals.addedSugar += nutrients.addedSugar * scale;
    totals.protein    += nutrients.protein    * scale;
    totals.totalFat   += nutrients.totalFat   * scale;
  }

  // Per serving
  const s = servings || 1;
  const perServing = {
    calories:    Math.round(totals.calories   / s),
    totalCarbs:  Math.round(totals.totalCarbs / s),
    fiber:       Math.round(totals.fiber      / s),
    addedSugar:  Math.round(totals.addedSugar / s),
    refinedCarbs:Math.round((totals.totalCarbs - totals.fiber) / s),
    protein:     Math.round(totals.protein    / s),
    totalFat:    Math.round(totals.totalFat   / s),
  };

  // Flags
  const flagSugar = perServing.addedSugar > 10;
  const flagCarbs = perServing.refinedCarbs > 40;
  const flagged   = flagSugar || flagCarbs;

  // Ask Claude for plain-English summary + swap if flagged
  const summaryPrompt = `You are a nutrition coach focused on weight loss and fatty liver health. Given nutrition data for the recipe "${recipeTitle || 'this dish'}", write ONLY a JSON object with two fields:
- "summary": a single plain-English sentence (max 12 words) describing the meal's metabolic impact. Be honest and specific. Examples: "High sugar — limit to once a week", "Low refined carbs, good fiber — solid choice", "High refined carbs — pair with a walk afterward."
- "swap": ${flagged ? `one specific, practical ingredient swap (max 15 words) that meaningfully improves "${recipeTitle || 'this dish'}" for liver health. The swap must make culinary sense for this specific dish — name the exact ingredient to replace and what to use instead.` : 'null'}

Nutrition per serving:
Calories: ${perServing.calories}
Total carbs: ${perServing.totalCarbs}g
Fiber: ${perServing.fiber}g
Refined carbs: ${perServing.refinedCarbs}g
Added sugar: ${perServing.addedSugar}g
Protein: ${perServing.protein}g
Fat: ${perServing.totalFat}g
${flagSugar ? 'FLAG: Added sugar exceeds 10g per serving.' : ''}
${flagCarbs ? 'FLAG: Refined carbs exceed 40g per serving.' : ''}

Return ONLY the JSON object, no other text.`;

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: summaryPrompt }]
    })
  });

  let summary = '';
  let swap = null;
  if (claudeRes.ok) {
    const claudeData = await claudeRes.json();
    try {
      const raw = claudeData.content[0].text;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      summary = parsed.summary || '';
      swap    = (parsed.swap && parsed.swap !== 'null') ? parsed.swap : null;
    } catch (_) {}
  }

  return {
    ...perServing,
    flagged,
    flagSugar,
    flagCarbs,
    summary,
    swap,
    calculatedAt: Date.now(),
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.json();
      const { type } = body;

      // ── Nutrition calculation ─────────────────────────────────────
      if (type === 'nutrition') {
        const result = await calculateNutrition(
          body.ingredients,
          body.servings,
          env.USDA_API_KEY,
          env.ANTHROPIC_API_KEY,
          body.title
        );
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // ── Recipe parsing (existing) ─────────────────────────────────
      const { content, mediaType } = body;
      let messageContent;
      if (type === 'image') {
        messageContent = [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: content } },
          { type: 'text', text: PARSE_PROMPT }
        ];
      } else {
        messageContent = PARSE_PROMPT + '\n\nRecipe to parse:\n\n' + content;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{ role: 'user', content: messageContent }]
        })
      });

      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
