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
  'cup': 240, 'cups': 240,
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

function toGrams(amount, unit) {
  const factor = UNIT_TO_GRAMS[unit?.toLowerCase()] ?? 100;
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

  const get = (name) => {
    const n = food.foodNutrients?.find(n => n.nutrientName?.toLowerCase().includes(name));
    return n?.value ?? 0;
  };

  return {
    calories:    get('energy'),
    totalCarbs:  get('carbohydrate'),
    fiber:       get('fiber'),
    addedSugar:  get('sugars, added'),
    totalSugars: get('sugars,'),
    protein:     get('protein'),
    totalFat:    get('total lipid'),
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
async function calculateNutrition(ingredients, servings, usdaKey, anthropicKey) {
  const totals = { calories:0, totalCarbs:0, fiber:0, addedSugar:0, protein:0, totalFat:0 };

  for (const ing of ingredients) {
    if (!ing.name) continue;
    const grams = toGrams(ing.amount || 1, ing.unit || '');
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
  const summaryPrompt = `You are a nutrition coach focused on weight loss and fatty liver health. Given this per-serving nutrition data for a recipe, write ONLY a JSON object with two fields:
- "summary": a single plain-English sentence (max 12 words) describing the meal's metabolic impact. Be honest and specific. Examples: "High sugar — limit to once a week", "Low refined carbs, good fiber — solid choice", "High refined carbs — pair with a walk afterward."
- "swap": ${flagged ? 'one specific ingredient swap (max 15 words) that meaningfully improves this meal for liver health. Name the exact ingredient to swap and what to swap it for.' : 'null'}

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

  let summary = 'Nutrition data calculated.';
  let swap = null;
  if (claudeRes.ok) {
    const claudeData = await claudeRes.json();
    try {
      const parsed = JSON.parse(claudeData.content[0].text);
      summary = parsed.summary || summary;
      swap    = parsed.swap    || null;
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
          env.ANTHROPIC_API_KEY
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
