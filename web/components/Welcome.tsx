'use client';
import { useState } from 'react';

const STARTERS = [
  {
    icon: '🍝',
    title: 'Cook a meal',
    hint: 'The dish. The ingredients. Sorted.',
    prompt: 'Plan a paneer dinner for 2 under ₹400',
  },
  {
    icon: '🥑',
    title: 'Buy groceries',
    hint: 'Your list, without the searching.',
    prompt: 'Find milk, eggs, bread and bananas',
  },
  {
    icon: '🫙',
    title: 'Restock the kitchen',
    hint: 'Bring the everyday essentials home.',
    prompt: 'Help me restock atta, rice and cooking oil',
  },
];

export default function Welcome({
  ready,
  connecting,
  onConnect,
  onPick,
}: {
  ready: boolean;
  connecting: boolean;
  onConnect: () => void;
  onPick: (text: string) => void;
}) {
  const [example, setExample] = useState(false);
  return (
    <section className="welcome-v2" aria-labelledby="welcome-heading">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">
            <span /> A little help for your everyday
          </span>
          <h1 id="welcome-heading">
            Good food.
            <br />
            Less <em>figuring out.</em>
          </h1>
          <p className="hero-description">
            A dinner idea or a grocery list. Tell Cookmate what you need, and build a Swiggy Instamart basket
            you can make your own.
          </p>
          {!ready ? (
            <>
              <button className="primary-action" onClick={onConnect} disabled={connecting}>
                {connecting ? 'Opening Swiggy…' : 'Connect Swiggy'} <span aria-hidden="true">↗</span>
              </button>
              <p className="login-caption">
                Sign in securely on Swiggy. Your phone number and OTP are entered there, not on Cookmate.
              </p>
            </>
          ) : (
            <p className="ready-caption">You’re connected. What’s on your list today?</p>
          )}
          <button
            className="text-action"
            onClick={() => setExample(!example)}
            aria-expanded={example}
            aria-controls="example-flow"
          >
            {example ? 'Hide example' : 'See how it works'}{' '}
            <span aria-hidden="true">{example ? '−' : '+'}</span>
          </button>
        </div>
        <div className="kitchen-scene">
          <div className="scene-label">
            FROM “WHAT’S FOR DINNER?”
            <br />
            <strong>to “that was easy.”</strong>
          </div>
          <svg viewBox="0 0 400 300" role="img" aria-label="Fresh groceries in a Cookmate shopping bag">
            <ellipse cx="208" cy="266" rx="127" ry="17" fill="#233f2f" opacity=".08" />
            <g transform="rotate(-16 140 150)">
              <rect x="103" y="66" width="50" height="129" rx="17" fill="#688653" />
              <rect x="117" y="36" width="23" height="42" rx="5" fill="#a6b584" />
              <rect x="111" y="31" width="34" height="13" rx="4" fill="#e5d9b1" />
              <rect x="110" y="107" width="36" height="52" rx="3" fill="#f8efd7" />
              <path
                d="M125 143v-21m0 12q18-17 11-18m-11 22q-16-11-12-18"
                stroke="#688653"
                strokeWidth="3"
                fill="none"
              />
            </g>
            <g transform="rotate(16 242 140)">
              <rect x="231" y="39" width="40" height="172" rx="20" fill="#d7a264" />
              <path
                d="m240 64 20 10m-20 21 20 10m-20 21 20 10"
                stroke="#efd2a3"
                strokeWidth="8"
                strokeLinecap="round"
              />
            </g>
            <g fill="#386348">
              <ellipse cx="195" cy="109" rx="23" ry="51" transform="rotate(-25 195 109)" />
              <ellipse cx="222" cy="107" rx="21" ry="53" transform="rotate(22 222 107)" />
              <ellipse cx="175" cy="124" rx="19" ry="35" transform="rotate(-53 175 124)" />
            </g>
            <path d="m211 164-18-83m19 75 12-85" stroke="#97b384" strokeWidth="3" />
            <circle cx="277" cy="158" r="32" fill="#e57747" />
            <path d="m273 126 4 13 12-7-8 12 11 5-17-1-9 7 3-13-9-7 12 2" fill="#476e44" />
            <path d="M91 143h220l-18 115q-91 23-184 0Z" fill="#d8b98d" />
            <path d="M91 143h220l-5 21H95Z" fill="#e7cea9" />
            <path
              d="M162 163v-28c0-44 77-44 77 0v28"
              fill="none"
              stroke="#86623d"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <text
              x="201"
              y="210"
              textAnchor="middle"
              fill="#4f5639"
              fontFamily="Georgia,serif"
              fontSize="28"
              fontStyle="italic"
            >
              cookmate
            </text>
            <text
              x="201"
              y="232"
              textAnchor="middle"
              fill="#675b43"
              fontFamily="sans-serif"
              fontSize="9"
              letterSpacing="2"
            >
              A LITTLE LESS ON YOUR PLATE
            </text>
          </svg>
          <div className="scene-note">
            <span aria-hidden="true">✓</span> Your basket. Your final say.
          </div>
        </div>
      </div>
      {example ? (
        <div className="example-flow" id="example-flow">
          <div>
            <span className="eyebrow">PREWRITTEN EXAMPLE · NO LIVE ORDER</span>
            <p className="example-request">“Paneer dinner for two. I have rice at home.”</p>
          </div>
          <ol>
            <li>
              <strong>Make a plan</strong>
              <span>Choose the meal, budget and ingredients you already have.</span>
            </li>
            <li>
              <strong>Build your basket</strong>
              <span>Find available products for your delivery address. Skip the rice.</span>
            </li>
            <li>
              <strong>Review, then order</strong>
              <span>Check quantities, the bill and payment method before confirming.</span>
            </li>
          </ol>
        </div>
      ) : null}
      <div className="starter-heading">
        <h2>{ready ? 'Start with a little inspiration' : 'One conversation. Three less things to do.'}</h2>
        <span>Made for your everyday</span>
      </div>
      <div className="starter-grid">
        {STARTERS.map((starter) => (
          <button key={starter.title} className="starter" onClick={() => onPick(starter.prompt)}>
            <span className="starter-icon" aria-hidden="true">
              {starter.icon}
            </span>
            <strong>
              {starter.title} <span aria-hidden="true">↗</span>
            </strong>
            <span>{starter.hint}</span>
          </button>
        ))}
      </div>
      {!ready ? (
        <details className="connection-details">
          <summary>What happens when I connect?</summary>
          <p>
            You continue to Swiggy to sign in and approve access. Cookmate receives a connection token, not
            your OTP. It can then use your saved addresses, basket and order details to help you shop. Your
            messages and relevant shopping details are processed by Cookmate’s AI provider.
          </p>
          <p>
            Nothing is ordered just by connecting. You review your basket and choose a payment method before
            placing an order. <a href="/privacy">Read how your data is used</a>.
          </p>
        </details>
      ) : null}
    </section>
  );
}
