/**
 * Link Understanding Module
 * 
 * Automatically detect and fetch content from URLs in user messages.
 * This helps the agent understand what the user is referring to.
 */

import { extractLinksFromMessage, containsLinks } from './detect';
import { fetchMultipleLinks, formatLinkContext, fetchLinkContent } from './fetch';

export interface LinkUnderstandingResult {
  urls: string[];
  context: string;
  hasLinks: boolean;
}

/**
 * Process a message to extract and fetch link content
 */
export async function understandLinks(message: string): Promise<LinkUnderstandingResult> {
  // Extract links
  const urls = extractLinksFromMessage(message);
  
  if (urls.length === 0) {
    return {
      urls: [],
      context: '',
      hasLinks: false,
    };
  }
  
  // Fetch content from links
  const contents = await fetchMultipleLinks(urls);
  
  // Format context
  const context = formatLinkContext(contents);
  
  return {
    urls,
    context,
    hasLinks: true,
  };
}

export { extractLinksFromMessage, containsLinks, fetchLinkContent, fetchMultipleLinks, formatLinkContext };
