import type { SqlExecutor } from "../../../../packages/evidence-store/src/index.js";
import type { VendorReceipt } from "../../../../packages/protocol-ts/src/index.js";

/**
 * The signed Vendor Receipt each received finalize mints. The submission
 * outcome names it only by `vendor_receipt_ref`, so without this record nothing
 * could later re-check the signature or normalize findings against it.
 * Append-only: a receipt is recorded once and never changed.
 */
export interface VendorReceiptStore {
  record(input: { submission_attempt_id: string; receipt: VendorReceipt }): Promise<{ outcome: "recorded" | "already_present" }>;
  find(vendorReceiptId: string): Promise<{ submission_attempt_id: string; receipt: VendorReceipt } | undefined>;
}

export function createMemoryVendorReceiptStore(): VendorReceiptStore {
  const receipts = new Map<string, { submission_attempt_id: string; receipt_body: string }>();
  return {
    async record(input) {
      if (receipts.has(input.receipt.vendor_receipt_id)) {
        return { outcome: "already_present" };
      }
      receipts.set(input.receipt.vendor_receipt_id, {
        submission_attempt_id: input.submission_attempt_id,
        receipt_body: JSON.stringify(input.receipt)
      });
      return { outcome: "recorded" };
    },
    async find(vendorReceiptId) {
      const row = receipts.get(vendorReceiptId);
      return row === undefined
        ? undefined
        : { submission_attempt_id: row.submission_attempt_id, receipt: JSON.parse(row.receipt_body) as VendorReceipt };
    }
  };
}

export function createPostgresVendorReceiptStore(sql: SqlExecutor): VendorReceiptStore {
  return {
    async record(input) {
      const inserted = await sql.query(
        `INSERT INTO submission_vendor_receipt (vendor_receipt_id, submission_attempt_id, receipt_body)
         VALUES ($1, $2, $3) ON CONFLICT (vendor_receipt_id) DO NOTHING
         RETURNING vendor_receipt_id`,
        [input.receipt.vendor_receipt_id, input.submission_attempt_id, JSON.stringify(input.receipt)]
      );
      return inserted.rows.length > 0 ? { outcome: "recorded" } : { outcome: "already_present" };
    },
    async find(vendorReceiptId) {
      const { rows } = await sql.query(
        "SELECT submission_attempt_id, receipt_body FROM submission_vendor_receipt WHERE vendor_receipt_id = $1",
        [vendorReceiptId]
      );
      const row = rows[0] as { submission_attempt_id: string; receipt_body: string } | undefined;
      return row === undefined
        ? undefined
        : { submission_attempt_id: row.submission_attempt_id, receipt: JSON.parse(row.receipt_body) as VendorReceipt };
    }
  };
}
