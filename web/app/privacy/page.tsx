export default function PrivacyPage() {
  return (
    <main className="info-page">
      <a href="/" className="text-action">
        ← Back to Cookmate
      </a>
      <span className="eyebrow">YOUR CONNECTION, EXPLAINED</span>
      <h1>Shopping with a little more clarity.</h1>
      <h2>Signing in</h2>
      <p>
        Cookmate is a platform for interacting with Swiggy Instamart. Phone and OTP entry happen on Swiggy’s
        website. Cookmate receives a connection token after you approve access; it does not receive your OTP.
      </p>
      <h2>Information used to help you shop</h2>
      <p>
        Cookmate uses your messages and relevant shopping information, including saved addresses, product
        results, your basket and order details. Messages and information needed for a request are sent to the
        AI service configured by Cookmate. Swiggy fulfils orders and handles payment through its supported
        methods.
      </p>
      <h2>What is saved</h2>
      <p>
        This browser stores your conversation, draft and a connection credential so you can return to
        Cookmate. The server keeps your shopping session and may save your Swiggy token and selected address
        in its database to restore your connection. Tokens expire according to Swiggy’s rules. Operational
        service logs may contain error and request information.
      </p>
      <h2>Disconnecting</h2>
      <p>
        Use Disconnect in the app to remove your saved Cookmate connection and the conversation stored in this
        browser. This does not cancel existing Swiggy orders or delete your Swiggy account. If you cannot
        reconnect to remove the saved connection, contact the project owner through the{' '}
        <a href="https://github.com/sushil23harsana/CookmateAI_SBC">Cookmate repository</a>. Do not post
        credentials, phone numbers, addresses or payment details in a public issue.
      </p>
      <h2>Before you order</h2>
      <p>
        Review the products, quantities, delivery address and payable amount. AI suggestions can be wrong.
        Check ingredients and packaging yourself for dietary needs and allergies.
      </p>
      <p>
        <a href="/help">Get help with connecting or ordering →</a>
      </p>
    </main>
  );
}
