/**
 * Tweet Fetcher Tool
 * 
 * Fetch tweets from X/Twitter without API keys.
 * Uses FxTwitter API for public tweet data.
 * 
 * NOTE: FxTwitter API availability varies. Some tweets may not be accessible
 * due to API restrictions or rate limiting.
 */

import { Tool, ToolCategory } from '../traits';

export interface TweetData {
  text: string;
  author: string;
  screen_name: string;
  likes: number;
  retweets: number;
  bookmarks: number;
  views: number;
  replies_count: number;
  created_at: string;
  media?: Array<{ type: string; url: string }>;
  quote?: {
    text: string;
    author: string;
    screen_name: string;
    likes: number;
  };
}

export class FetchTweetTool implements Tool {
  name = 'fetch_tweet';
  description = 'Fetch a tweet from X/Twitter by URL. CRITICAL: Call this immediately when user shares any x.com or twitter.com URL. No API key needed. Note: FxTwitter API availability varies, some tweets may not be accessible.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      url: { 
        type: 'string', 
        description: 'Tweet URL (e.g., https://x.com/username/status/123456789). Must be a valid x.com or twitter.com URL.' 
      },
    },
    required: ['url'],
  };

  async execute(args: { url: string }): Promise<{ success: boolean; data?: TweetData; error?: string }> {
    try {
      const tweetData = await fetchTweet(args.url);
      return { success: true, data: tweetData };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch tweet' 
      };
    }
  }
}

export class FetchUserTweetsTool implements Tool {
  name = 'fetch_user_tweets';
  description = 'Fetch recent tweets from a user timeline. No API key needed.';
  category = ToolCategory.EXTERNAL;
  parameters = {
    type: 'object' as const,
    properties: {
      username: { 
        type: 'string', 
        description: 'X/Twitter username (without @)' 
      },
      limit: { 
        type: 'number', 
        description: 'Number of tweets to fetch (max 20)',
        default: 5 
      },
    },
    required: ['username'],
  };

  async execute(args: { username: string; limit?: number }): Promise<{ 
    success: boolean; 
    data?: TweetData[]; 
    error?: string 
  }> {
    try {
      const username = args.username.replace(/^@/, '');
      const limit = Math.min(args.limit || 5, 20);
      
      // Fetch from FxTwitter RSS feed
      const tweets = await fetchUserTweets(username, limit);
      return { success: true, data: tweets };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch user tweets' 
      };
    }
  }
}

/**
 * Parse tweet URL to get username and tweet ID
 */
function parseTweetUrl(url: string): { username: string; tweetId: string } {
  // Support various X/Twitter URL formats
  const patterns = [
    /x\.com\/(\w+)\/status\/(\d+)/,
    /twitter\.com\/(\w+)\/status\/(\d+)/,
    /x\.com\/(\w+)\/status\/(\d+)\?/,
    /twitter\.com\/(\w+)\/status\/(\d+)\?/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { username: match[1], tweetId: match[2] };
    }
  }

  throw new Error('Invalid tweet URL. Expected format: https://x.com/username/status/123456');
}

/**
 * Fetch single tweet via FxTwitter API
 */
async function fetchTweet(url: string): Promise<TweetData> {
  const { username, tweetId } = parseTweetUrl(url);
  const apiUrl = `https://api.fxtwitter.com/${username}/status/${tweetId}`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tweet: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { code: number; message?: string; tweet: any };

  if (data.code !== 200) {
    throw new Error(`API error: ${data.message || 'Unknown error'}`);
  }

  const tweet = data.tweet;
  
  return {
    text: tweet.text || '',
    author: tweet.author?.name || '',
    screen_name: tweet.author?.screen_name || '',
    likes: tweet.likes || 0,
    retweets: tweet.retweets || 0,
    bookmarks: tweet.bookmarks || 0,
    views: tweet.views || 0,
    replies_count: tweet.replies || 0,
    created_at: tweet.created_at || '',
    media: extractMedia(tweet),
    quote: tweet.quote ? {
      text: tweet.quote.text || '',
      author: tweet.quote.author?.name || '',
      screen_name: tweet.quote.author?.screen_name || '',
      likes: tweet.quote.likes || 0,
    } : undefined,
  };
}

/**
 * Fetch user tweets via FxTwitter
 */
async function fetchUserTweets(username: string, limit: number): Promise<TweetData[]> {
  // Use FxTwitter timeline API
  const apiUrl = `https://api.fxtwitter.com/${username}/timeline`;
  
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!response.ok) {
    // Fallback: try to fetch individual tweets if timeline fails
    throw new Error(`Failed to fetch timeline: ${response.status}`);
  }

  const data = await response.json() as { code: number; tweets?: any[] };
  
  if (data.code !== 200 || !data.tweets) {
    throw new Error('No tweets found or API error');
  }

  return data.tweets.slice(0, limit).map((tweet: any) => ({
    text: tweet.text || '',
    author: tweet.author?.name || '',
    screen_name: tweet.author?.screen_name || '',
    likes: tweet.likes || 0,
    retweets: tweet.retweets || 0,
    bookmarks: tweet.bookmarks || 0,
    views: tweet.views || 0,
    replies_count: tweet.replies || 0,
    created_at: tweet.created_at || '',
    media: extractMedia(tweet),
  }));
}

/**
 * Extract media from tweet data
 */
function extractMedia(tweet: any): Array<{ type: string; url: string }> | undefined {
  const media: Array<{ type: string; url: string }> = [];

  if (tweet.media?.photos) {
    for (const photo of tweet.media.photos) {
      media.push({ type: 'photo', url: photo.url || photo });
    }
  }

  if (tweet.media?.videos) {
    for (const video of tweet.media.videos) {
      media.push({ type: 'video', url: video.thumbnail_url || video.url });
    }
  }

  return media.length > 0 ? media : undefined;
}

/**
 * Format tweet for display
 */
export function formatTweet(tweet: TweetData): string {
  let output = `🐦 @${tweet.screen_name}\n`;
  output += `${tweet.text}\n\n`;
  output += `❤️ ${tweet.likes}  🔁 ${tweet.retweets}  👁 ${tweet.views}\n`;
  
  if (tweet.quote) {
    output += `\n📌 Quoting @${tweet.quote.screen_name}:\n`;
    output += `   ${tweet.quote.text.slice(0, 100)}${tweet.quote.text.length > 100 ? '...' : ''}\n`;
  }

  return output;
}
