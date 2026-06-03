import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "GTBank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank", code: "011" },
  { name: "UBA", code: "033" },
  { name: "Fidelity Bank", code: "070" },
  { name: "FCMB", code: "214" },
  { name: "Stanbic IBTC", code: "221" },
  { name: "Sterling Bank", code: "232" },
  { name: "Union Bank", code: "032" },
  { name: "Wema Bank", code: "035" },
  { name: "Polaris Bank", code: "076" },
  { name: "Kuda Bank", code: "090267" },
  { name: "Opay", code: "305" },
  { name: "PalmPay", code: "999991" },
];

type KYCStatus = "unverified" | "pending" | "verified" | "rejected";

interface KYCData {
  kyc_status: KYCStatus;
  full_name: string | null;
  bank_name: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

const STATUS_INFO: Record<KYCStatus, { label: string; color: string; icon: string }> = {
  unverified: { label: "Not submitted", color: "text-gray-500", icon: "📋" },
  pending: { label: "Under review", color: "text-amber-600", icon: "⏳" },
  verified: { label: "Verified", color: "text-emerald-600", icon: "✅" },
  rejected: { label: "Rejected", color: "text-red-600", icon: "❌" },
};

export default function CreatorKYCScreen() {
  const [kycData, setKycData] = useState<KYCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [bvnLast4, setBvnLast4] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [selectedBank, setSelectedBank] = useState(NIGERIAN_BANKS[0]);

  useEffect(() => {
    const token = storage.getString("authToken");
    fetch(`${API_BASE}/api/creator/kyc`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        const data: KYCData = d.data;
        setKycData(data);
        if (data.full_name) setFullName(data.full_name);
        if (data.bank_name) {
          const bank = NIGERIAN_BANKS.find((b) => b.name === data.bank_name);
          if (bank) setSelectedBank(bank);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function submitKYC() {
    if (!fullName.trim() || bvnLast4.length !== 4 || bankAccount.length < 10) {
      Alert.alert("Incomplete", "Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/creator/kyc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        full_name: fullName.trim(),
        bvn_last4: bvnLast4,
        bank_account_number: bankAccount.trim(),
        bank_code: selectedBank.code,
        bank_name: selectedBank.name,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setKycData((prev) => prev ? { ...prev, kyc_status: "pending" } : null);
      Alert.alert("Submitted!", "Your KYC is under review. We'll notify you within 24 hours.");
    } else {
      Alert.alert("Error", "Submission failed. Please try again.");
    }
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  const status = kycData?.kyc_status ?? "unverified";
  const info = STATUS_INFO[status];

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4">
      {/* Status banner */}
      <View className="bg-white rounded-xl p-4 mb-4 shadow-sm flex-row items-center">
        <Text className="text-2xl mr-3">{info.icon}</Text>
        <View>
          <Text className="font-semibold text-gray-900">KYC Status</Text>
          <Text className={`text-sm ${info.color}`}>{info.label}</Text>
          {status === "rejected" && kycData?.rejection_reason && (
            <Text className="text-red-500 text-xs mt-1">{kycData.rejection_reason}</Text>
          )}
          {status === "verified" && kycData?.verified_at && (
            <Text className="text-gray-400 text-xs">Verified on {new Date(kycData.verified_at).toLocaleDateString()}</Text>
          )}
        </View>
      </View>

      {status === "verified" ? (
        <View className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 items-center">
          <Text className="text-emerald-700 font-semibold">KYC Complete</Text>
          <Text className="text-emerald-600 text-sm mt-1">You can now receive creator payouts.</Text>
        </View>
      ) : status === "pending" ? (
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 items-center">
          <Text className="text-amber-700 font-semibold">Under Review</Text>
          <Text className="text-amber-600 text-sm mt-1 text-center">Your KYC is being reviewed. This usually takes 24-48 hours.</Text>
        </View>
      ) : (
        <>
          <Text className="text-gray-600 text-sm mb-4">
            Complete KYC verification to enable creator payouts. Your information is encrypted and stored securely.
          </Text>

          <Text className="text-sm font-medium text-gray-700 mb-1">Full Name *</Text>
          <TextInput className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 text-gray-800"
            placeholder="As it appears on your ID" value={fullName} onChangeText={setFullName} />

          <Text className="text-sm font-medium text-gray-700 mb-1">Last 4 digits of BVN *</Text>
          <TextInput className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 text-gray-800"
            placeholder="e.g. 4521" value={bvnLast4} onChangeText={(v) => setBvnLast4(v.slice(0, 4))}
            keyboardType="numeric" maxLength={4} />

          <Text className="text-sm font-medium text-gray-700 mb-1">Bank *</Text>
          <View className="bg-white border border-gray-200 rounded-xl mb-3 overflow-hidden">
            <Picker selectedValue={selectedBank.code} onValueChange={(code) => {
              const bank = NIGERIAN_BANKS.find((b) => b.code === code);
              if (bank) setSelectedBank(bank);
            }}>
              {NIGERIAN_BANKS.map((b) => <Picker.Item key={b.code} label={b.name} value={b.code} />)}
            </Picker>
          </View>

          <Text className="text-sm font-medium text-gray-700 mb-1">Account Number *</Text>
          <TextInput className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-6 text-gray-800"
            placeholder="10-digit account number" value={bankAccount} onChangeText={setBankAccount}
            keyboardType="numeric" maxLength={10} />

          <TouchableOpacity
            className={`py-4 rounded-xl items-center ${submitting ? "bg-gray-200" : "bg-blue-600"}`}
            onPress={() => void submitKYC()} disabled={submitting}
          >
            <Text className={`font-bold ${submitting ? "text-gray-400" : "text-white"}`}>
              {submitting ? "Submitting..." : "Submit KYC"}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}
