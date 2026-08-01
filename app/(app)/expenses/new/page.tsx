"use client";

import ExpenseForm from "@/components/ExpenseForm";

export default function NewExpensePage() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <ExpenseForm mode="create" />
    </div>
  );
}
