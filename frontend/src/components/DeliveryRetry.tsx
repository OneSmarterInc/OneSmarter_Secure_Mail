import { useState } from "react";
import { ApiError, post } from "../api";
import { ErrorNotice, Modal, StepUp } from "./ui";

export function DeliveryRetry({
  id,
  onRetried,
}: {
  id: string;
  onRetried: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true);
    setError("");
    try {
      await post(`/delivery/${id}/retry`, { acknowledge_duplicate_risk: true });
      setOpen(false);
      onRetried();
    } catch (err) {
      if (err instanceof ApiError && err.code === "step_up_required")
        setStepUp(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="text-button" onClick={() => setOpen(true)}>
        Retry notification
      </button>
      {open && (
        <Modal title="Retry this notification?" onClose={() => setOpen(false)}>
          {stepUp ? (
            <StepUp onDone={() => setStepUp(false)} />
          ) : (
            <>
              <p>
                The provider may have accepted the previous attempt even if its
                response was lost. Retrying can send a duplicate. Access
                permissions and invitation validity will be checked again.
              </p>
              <ErrorNotice message={error} />
              <div className="form-footer">
                <button onClick={() => setOpen(false)}>Cancel</button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void retry()}
                >
                  Confirm retry
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
