"use client";

import { useState } from "react";
import { ArrowRight, Check, CircleAlert, ImageIcon, ShoppingBag } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@relay/ui-react/components/card";

const actions = ["Open checkout", "Apply SAVE10", "Check the total"];

/** A labelled, local illustration. It never claims to execute a Test. */
export function ProductPreview() {
  const [selectedStep, setSelectedStep] = useState(2);
  const [failed, setFailed] = useState(false);
  const hasDiscount = selectedStep > 0 && !failed;
  return (
    <div className="min-w-0" id="product">
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-route-gold" aria-hidden="true" /> Interactive
        example · select a step to inspect it
      </p>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Checkout · Promo code</CardTitle>
            <span
              className={`inline-flex items-center gap-1 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
            >
              {failed ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />}
              {failed ? "1 issue" : "Passed"}
            </span>
          </div>
          <CardDescription>A saved test and its captured result.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3">
              <div role="group" aria-label="Example test steps" className="grid gap-1">
                {actions.map((action, index) => (
                  <Button
                    key={action}
                    variant={selectedStep === index ? "secondary" : "ghost"}
                    aria-pressed={selectedStep === index}
                    onClick={() => setSelectedStep(index)}
                    className="h-11 w-full justify-start"
                  >
                    <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="text-xs">{action}</span>
                    {failed && index === 2 ? (
                      <CircleAlert className="ml-auto size-3.5 text-destructive" />
                    ) : (
                      <Check className="ml-auto size-3.5 text-muted-foreground" />
                    )}
                  </Button>
                ))}
              </div>
              <div
                className="min-h-24 border-t pt-3 text-xs leading-6"
                role="status"
                aria-live="polite"
              >
                <p className="font-medium">
                  {selectedStep === 2
                    ? "Check the discounted total"
                    : selectedStep === 1
                      ? "The promo code is applied"
                      : "The checkout is open"}
                </p>
                {failed && selectedStep === 2 ? (
                  <>
                    <p className="text-muted-foreground">Expected $45.00</p>
                    <p className="text-destructive">Saw $50.00 · discount missing</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {selectedStep === 2 ? "$45.00, as expected" : "Step completed"}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setFailed(!failed);
                  setSelectedStep(2);
                }}
                className="h-11 justify-start"
              >
                <span className="text-xs">
                  {failed ? "Show a passing run" : "See a failed run"}
                </span>
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
            <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ImageIcon className="size-3.5" /> After step {selectedStep + 1}
              </p>
              <div className="rounded-lg border bg-card p-3 text-xs">
                <p className="flex items-center gap-2 font-medium">
                  <ShoppingBag className="size-4" /> Studio Supply
                </p>
                <div className="my-5 flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <ShoppingBag className="size-4 text-muted-foreground" />
                  </span>
                  <div>
                    <p className="font-medium">Everyday tote</p>
                    <p className="mt-1 text-muted-foreground">Qty 1 · $50.00</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-muted-foreground">
                  <span>{selectedStep === 0 ? "Promo code" : "SAVE10"}</span>
                  <span>{hasDiscount ? "Applied" : "Apply"}</span>
                </div>
                <div className="my-4 min-h-11 space-y-2 text-muted-foreground">
                  <p className="flex justify-between gap-2">
                    <span>Subtotal</span>
                    <span>$50.00</span>
                  </p>
                  {hasDiscount ? (
                    <p className="flex justify-between gap-2">
                      <span>Discount</span>
                      <span>−$5.00</span>
                    </p>
                  ) : null}
                </div>
                <p
                  className={`flex justify-between gap-2 border-t pt-3 font-medium tabular-nums ${failed && selectedStep === 2 ? "text-destructive" : ""}`}
                >
                  <span>Total</span>
                  <span>{hasDiscount ? "$45.00" : "$50.00"}</span>
                </p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Sample app · no payment is made</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
