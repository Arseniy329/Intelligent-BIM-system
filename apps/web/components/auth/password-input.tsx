"use client";
import { useState, type ComponentProps } from "react";

export function PasswordInput(props: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-password">
    <input {...props} type={visible ? "text" : "password"} />
    <button type="button" disabled={props.disabled} aria-label={visible ? "Приховати пароль" : "Показати пароль"} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? "Приховати" : "Показати"}</button>
  </div>;
}
