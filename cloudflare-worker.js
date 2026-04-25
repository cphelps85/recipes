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

// ── Nutrition via Claude ──────────────────────────────────────────────
async function calculateNutrition(ingredients, servings, anthropicKey, recipeTitle) {
  // Format ingredient list for the prompt
  const ingList = ingredients
    .filter(i => i.name && (i.amount > 0 || !i.amount))
    .map(i => {
      const amt = i.amount ? `${i.amount}${i.unit ? ' ' + i.unit : ''}` : '';
      return `- ${amt ? amt + ' ' : ''}${i.name}`;
    }).join('\n');

  const prompt = `You are a registered dietitian with expertise in nutrition for weight loss and fatty liver disease management.

Calculate the per-serving nutrition for this recipe. Use standard USDA food composition values. Be accurate — account for cooking methods (e.g. fat renders out of ground beef when drained, baking uses less fat than frying).

Recipe: "${recipeTitle || 'Unknown'}"
Servings: ${servings || 4}

Ingredients:
${ingList}

Return ONLY a JSON object with these exact fields (all numbers are per serving):
{
  "calories": <number>,
  "totalCarbs": <number in grams>,
  "fiber": <number in grams>,
  "addedSugar": <number in grams — only sugar added during cooking/processing, not natural fruit/milk sugars>,
  "refinedCarbs": <number in grams — totalCarbs minus fiber>,
  "protein": <number in grams>,
  "totalFat": <number in grams>,
  "summary": "<one honest plain-English sentence, max 12 words, about the meal's metabolic impact — be specific, not generic. Examples: 'High sugar — limit to once a week', 'Low refined carbs, good fiber — solid choice', 'High refined carbs — pair with a walk afterward'>",
  "swap": <${`"one specific, practical ingredient swap that meaningfully improves this recipe for liver health — must make culinary sense for ${recipeTitle || 'this dish'}. Format: 'Swap X for Y to [benefit].' Max 20 words."`} if refinedCarbs > 40 OR addedSugar > 10, otherwise null>
}

Return ONLY the JSON object, no other text, no markdown.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error('Claude API error: ' + res.status);
  const data = await res.json();
  const raw = data.content[0].text;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  const flagSugar = (parsed.addedSugar || 0) > 10;
  const flagCarbs = (parsed.refinedCarbs || 0) > 40;

  return {
    calories:     Math.round(parsed.calories     || 0),
    totalCarbs:   Math.round(parsed.totalCarbs   || 0),
    fiber:        Math.round(parsed.fiber        || 0),
    addedSugar:   Math.round(parsed.addedSugar   || 0),
    refinedCarbs: Math.round(parsed.refinedCarbs || 0),
    protein:      Math.round(parsed.protein      || 0),
    totalFat:     Math.round(parsed.totalFat     || 0),
    summary:      parsed.summary || '',
    swap:         (parsed.swap && parsed.swap !== 'null') ? parsed.swap : null,
    flagged:      flagSugar || flagCarbs,
    flagSugar,
    flagCarbs,
    calculatedAt: Date.now(),
  };
}

// ── Menu scanner via Claude ──────────────────────────────────────────
async function scanMenu(images, anthropicKey) {
  const prompt = `You are a nutrition-aware restaurant guide helping someone managing fatty liver disease. Their goals: lower refined carbs, liver-friendly choices (low added sugar, not deep-fried), and protein-forward meals.

The images above show pages of a restaurant menu. Recommend exactly 5 items, ranked best-to-worst fit.

Critical rules:
- No more than 2 of the 5 picks may be salads. Salads with sweet dressings, dried fruit, croutons, or candied nuts are often worse than a grilled protein — only include a salad if it is protein-forward with a simple dressing.
- Spread picks across DIFFERENT dish types — e.g. a grilled protein, a fish dish, a lettuce-wrap or bunless option, a veggie-forward plate, a soup. Variety matters.
- Best picks: grilled/baked/braised proteins (fish, chicken, lean beef), dishes with non-starchy vegetables, broth-based soups.
- Avoid: pasta, white rice bowls, fried items, sandwiches/burgers on bread (unless you note "ask for no bun"), heavy cream sauces.
- If a burger or sandwich is the best available option, include it and note "ask for no bun" or "lettuce wrap".
- Be honest — if the menu is mostly unhealthy, say so in the note for lower-ranked picks.

Return ONLY a JSON object:
{
  "picks": [
    { "name": "Exact menu item name", "note": "One sentence, max 12 words, on why this is a good pick" },
    { "name": "...", "note": "..." }
  ]
}

Return ONLY the JSON, no other text.`;

  const imageContent = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.imageData }
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [...imageContent, { type: 'text', text: prompt }]
      }]
    })
  });

  if (!res.ok) throw new Error('Claude API error: ' + res.status);
  const data = await res.json();
  const raw = data.content[0].text;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : raw);
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

      // ── Menu scanner ──────────────────────────────────────────────
      if (type === 'menu') {
        const result = await scanMenu(body.images, env.ANTHROPIC_API_KEY);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // ── Nutrition calculation ─────────────────────────────────────
      if (type === 'nutrition') {
        const result = await calculateNutrition(
          body.ingredients,
          body.servings,
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
