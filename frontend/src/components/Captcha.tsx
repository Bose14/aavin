import { useState, useEffect, useCallback } from 'react';

interface CaptchaProps {
  onVerify: (valid: boolean) => void;
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default function Captcha({ onVerify }: CaptchaProps) {
  const [code, setCode] = useState(generateCode);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    setCode(generateCode());
    setInput('');
    setError(false);
    onVerify(false);
  }, [onVerify]);

  useEffect(() => {
    if (input.length === 6) {
      const valid = input === code;
      setError(!valid);
      onVerify(valid);
      if (!valid) setTimeout(refresh, 800);
    } else {
      onVerify(false);
    }
  }, [input, code, onVerify, refresh]);

  // Render code as individual styled spans with slight random tilt per digit
  const digits = code.split('').map((d, i) => {
    const tilt = [-8, 5, -4, 7, -6, 4][i] ?? 0;
    return (
      <span
        key={i}
        style={{
          display: 'inline-block',
          transform: `rotate(${tilt}deg)`,
          fontFamily: 'monospace',
          fontSize: '1.6rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: ['#4f46e5', '#1d4ed8', '#7c3aed', '#2563eb', '#4338ca', '#6d28d9'][i],
          userSelect: 'none',
        }}
      >
        {d}
      </span>
    );
  });

  return (
    <div className="captcha-wrap">
      <div className="captcha-code" aria-label="Captcha code">
        <div className="captcha-noise">{digits}</div>
        <button type="button" onClick={refresh} className="captcha-refresh" title="Refresh code">↻</button>
      </div>
      <div className="form-group">
        <label>Enter the code above</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={input}
          onChange={e => setInput(e.target.value.replace(/\D/g, ''))}
          placeholder="6-digit code"
          className={error ? 'input-error' : ''}
          autoComplete="off"
        />
        {error && <span className="auth-error" style={{ fontSize: '0.8rem' }}>Incorrect code — try the new one</span>}
      </div>
    </div>
  );
}
