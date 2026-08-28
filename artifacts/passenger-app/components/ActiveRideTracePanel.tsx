import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ActiveRideDiag } from "@/lib/activeRideDiag";

/** Always-visible on-trip / home trace so Ad can see why Active Ride shows or not. */
export function ActiveRideTracePanel({ diag }: { diag: ActiveRideDiag | null | undefined }) {
  const d = diag;
  const lines: string[] = [];
  if (!d) {
    lines.push("diag: (not wired)");
  } else {
    lines.push(`phase: ${d.phase}  ·  hydrateReady: ${d.hydrateReady ? "yes" : "no"}`);
    lines.push(`uid: ${d.uid || "—"}`);
    lines.push(`AsyncStorage job: ${d.asyncStorageJobId}`);
    lines.push(`activeRide: ${d.activeRideJobId} / ${d.activeRideStatus}`);
    lines.push(`listeners: ${d.listenersKey}`);
    lines.push(`last live RTDB Status: ${d.lastLiveRtdbStatus}`);
    lines.push(`DECISION: ${d.decision}`);
    for (const p of (d.probes || []).slice(0, 4)) {
      lines.push("—");
      lines.push(`job ${p.jobId} @ ${p.companyId}`);
      lines.push(`  Passengerjobs: ${p.passengerjobsStatus}`);
      lines.push(`  pendingjobs:   ${p.pendingjobsStatus}${p.hasPendingJobsNode ? "" : " (no node)"}`);
      lines.push(`  allbookings:   ${p.allbookingsStatus}`);
      lines.push(`  pay/driver:    ${p.paymentStatus} / ${p.driverId}`);
      lines.push(`  authoritative: ${p.authoritativeStatus}`);
      lines.push(`  → ${p.decision}`);
    }
    lines.push(`updated: ${d.at}`);
  }

  return (
    <View style={styles.wrap} accessibilityLabel="Active ride trace">
      <Text style={styles.title}>ACTIVE RIDE TRACE (for Ad)</Text>
      {lines.map((line, i) => (
        <Text key={`${i}-${line.slice(0, 24)}`} style={styles.line} selectable>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#111827",
    borderWidth: 2,
    borderColor: "#f59e0b",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 2,
  },
  title: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  line: {
    color: "#e5e7eb",
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 15,
  },
});
