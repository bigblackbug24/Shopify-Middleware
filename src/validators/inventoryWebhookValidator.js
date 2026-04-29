const Joi = require('joi');

/**
 * Joi schema for inventory update webhook payload.
 *
 * Sent by a third-party system (ERP, WMS, etc.) to update
 * Shopify stock levels via our middleware.
 */
const inventoryWebhookSchema = Joi.object({
  sku: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .required()
    .messages({ 'any.required': 'sku is required' }),

  quantity: Joi.number()
    .integer()
    .min(0)
    .required()
    .messages({
      'any.required': 'quantity is required',
      'number.min':   'quantity cannot be negative',
    }),

  // Optional: override which Shopify location to update
  // If not provided, we use the first location from Shopify
  location_id: Joi.string().optional().allow(null, ''),
});

/**
 * Validate inventory webhook payload.
 *
 * @param {Object} payload - req.body
 * @returns {Object} validated + cleaned payload
 * @throws {Error} if validation fails
 */
function validateInventoryWebhook(payload) {
  const { error, value } = inventoryWebhookSchema.validate(payload, {
    abortEarly:   false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join(', ');
    throw new Error(`Validation failed: ${messages}`);
  }

  return value;
}

module.exports = { validateInventoryWebhook };
