/**
 * This file is for add custom handlebars helpers purpose
 * Read further about registerHelper on this link below
 * http://handlebarsjs.com/block_helpers.html
 */

/**
 * Noop helpers
 * @param {Object} options
 */
exports.noop = options => options.fn(this)
