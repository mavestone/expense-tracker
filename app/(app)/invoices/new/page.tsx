"use client";

import { Suspense } from "react";
import InvoiceForm from "@/components/InvoiceForm";

export default function NewInvoicePage() {
  return (
    <div>
      <div className="section-head">
        <h1>New invoice</h1>
      </div>
      <Suspense fallback={<div className="empty"><span className="spin" /> Loading…</div>}>
        <InvoiceForm />
      </Suspense>
    </div>
  );
}
