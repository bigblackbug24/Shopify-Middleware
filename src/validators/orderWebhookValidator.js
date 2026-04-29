const Joi = require('joi');

/**
 * Joi schema for a single line item inside a Shopify order webhook.
 *
 * Notes:
 *  - product_id / variant_id can be number or string (Shopify sends both)
 *  - price can be "99.99" (string) or 99.99 (number)
 *  - .unknown(true) — Shopify sends many extra fields, we allow them
 */
const lineItemSchema = Joi.object({
  product_id: Joi.alternatives()
    .try(Joi.number().positive(), Joi.string().min(1))
    .required()
    .messages({ 'any.required': 'line_items[].product_id is required' }),

  variant_id: Joi.alternatives()
    .try(Joi.number().positive(), Joi.string().min(1))
    .required()
    .messages({ 'any.required': 'line_items[].variant_id is required' }),

  quantity: Joi.number()
    .integer()
    .min(1)
    .required()
    .messages({ 'number.min': 'line_items[].quantity must be at least 1' }),

  price: Joi.alternatives()
    .try(
      Joi.number().min(0),
      Joi.string().pattern(/^\d+(\.\d{1,2})?$/)
    )
    .required()
    .messages({ 'any.required': 'line_items[].price is required' }),

  title: Joi.string().max(500).optional().allow('', null),
  sku:   Joi.string().max(255).optional().allow('', null),

}).unknown(true);

/**
 * Joi schema for the full Shopify order webhook payload.
 *
 * Notes:
 *  - id is the Shopify order ID (large integer)
 *  - total_price can be string "199.99" or number 199.99
 *  - currency is optional (defaults to USD in DTO)
 *  - .unknown(true) — Shopify sends many extra fields
 */
const orderWebhookSchema = Joi.object({
  id: Joi.number()
    .positive()
    .required()
    .messages({ 'any.required': 'Shopify order id is required' }),

  email: Joi.string()
    .email({ tlds: { allow: false } })
    .max(255)
    .required()
    .messages({
      'string.email':    'email must be a valid email address',
      'any.required':    'email is required',
    }),

  total_price: Joi.alternatives()
    .try(
      Joi.number().min(0),
      Joi.string().pattern(/^\d+(\.\d{1,2})?$/)
    )
    .required()
    .messages({ 'any.required': 'total_price is required' }),

  currency: Joi.string()
    .length(3)
    .uppercase()
    .optional()
    .default('USD'),

  order_number: Joi.number().optional().allow(null),

  line_items: Joi.array()
    .items(lineItemSchema)
    .min(1)
    .required()
    .messages({
      'array.min':    'line_items must contain at least 1 item',
      'any.required': 'line_items is required',
    }),

  created_at: Joi.string().isoDate().optional().allow(null),
  note:       Joi.string().max(5000).optional().allow('', null),
  tags:       Joi.string().optional().allow('', null),

}).unknown(true);

/**
 * Validate raw Shopify webhook payload.
 *
 * @param {Object} payload - req.body from webhook endpoint
 * @returns {Object}       - Validated and cleaned payload
 * @throws {Error}         - If validation fails (with all error messages)
 */
function validateOrderWebhook(payload) {
  const { error, value } = orderWebhookSchema.validate(payload, {
    abortEarly:   false,   // Collect ALL errors, not just first
    stripUnknown: false,   // Keep extra Shopify fields (DTO will ignore them)
    convert:      true,    // Convert types where possible (string → number)
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join(', ');
    throw new Error(`Webhook validation failed: ${messages}`);
  }

  return value;
}

module.exports = { validateOrderWebhook, orderWebhookSchema, lineItemSchema };
