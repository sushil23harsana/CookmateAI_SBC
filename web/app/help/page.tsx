export default function HelpPage() {
  return (
    <main className="info-page">
      <a href="/" className="text-action">
        ← Back to Cookmate
      </a>
      <span className="eyebrow">A HAND WHEN YOU NEED ONE</span>
      <h1>Let’s get you shopping.</h1>
      <h2>How do I get started?</h2>
      <p>
        Tap Connect Swiggy, sign in on Swiggy’s website, and approve the connection. You’ll return to
        Cookmate. Check your delivery address, then send a meal idea or grocery list. You can type a draft
        before connecting; it will wait for you.
      </p>
      <h2>My connection is taking a while</h2>
      <p>
        The service can take a moment to wake up. Keep your draft and use Check connection if an error
        appears. If Swiggy says your sign-in expired, start Connect Swiggy again. Never share your OTP in
        chat.
      </p>
      <h2>Can I edit the basket?</h2>
      <p>
        Use the quantity buttons in Your basket, or ask Cookmate to remove, replace or find a cheaper product.
        Edits check prices again. Changing your delivery address means the basket needs to be reviewed again
        too.
      </p>
      <h2>Has my order been placed?</h2>
      <p>
        Connecting or chatting does not place an order. Review &amp; pay opens your final review. Choosing a
        payment method submits the order. If the result is unclear or payment is still pending, check the
        Swiggy app before trying again.
      </p>
      <h2>Payment, delivery or a refund</h2>
      <p>
        Open the relevant order in the Swiggy app and use Swiggy’s order help. Cookmate cannot promise a
        refund or change Swiggy’s delivery and payment decisions.
      </p>
      <h2>Report an app problem</h2>
      <p>
        Report a reproducible app issue in the{' '}
        <a href="https://github.com/sushil23harsana/CookmateAI_SBC/issues">Cookmate issue tracker</a>. Share
        what happened and the error message, without personal information, tokens, addresses or payment
        details.
      </p>
      <p>
        <a href="/privacy">How Cookmate uses your data →</a>
      </p>
    </main>
  );
}
