import type { Components } from 'react-markdown';

/**
 * Shared ReactMarkdown component overrides for rendered chat messages.
 * Links open in a new tab (with noopener/noreferrer) so following a source
 * doesn't navigate away from the conversation.
 */
export const markdownComponents: Components = {
  a({ node, ...props }) {
    // `node` is the hast node react-markdown passes to custom components;
    // dropping it here keeps it off the DOM element.
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
};
