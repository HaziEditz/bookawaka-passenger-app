import { Router } from "express";

const router = Router();
const MAPS_KEY = process.env["GOOGLE_MAPS_API_KEY"] ?? "";

router.get("/places/autocomplete", async (req, res) => {
  const { input, location, radius } = req.query;
  if (!input || typeof input !== "string") {
    res.status(400).json({ error: "input query param required" });
    return;
  }
  try {
    const params = new URLSearchParams({
      input,
      key: MAPS_KEY,
      types: "geocode|establishment",
      components: "country:nz",
    });
    if (typeof req.query.components === "string" && req.query.components.trim()) {
      params.set("components", req.query.components.trim());
    }
    if (location && typeof location === "string") {
      params.set("location", location);
      params.set("radius", typeof radius === "string" ? radius : "50000");
    }
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Places API request failed" });
  }
});

router.get("/places/details", async (req, res) => {
  const { place_id } = req.query;
  if (!place_id || typeof place_id !== "string") {
    res.status(400).json({ error: "place_id query param required" });
    return;
  }
  try {
    const params = new URLSearchParams({
      place_id,
      fields: "geometry,name,formatted_address,place_id",
      key: MAPS_KEY,
    });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Places Details API request failed" });
  }
});

router.get("/places/geocode", async (req, res) => {
  const { place_id, address } = req.query;
  try {
    const params = new URLSearchParams({ key: MAPS_KEY });
    if (place_id && typeof place_id === "string") params.set("place_id", place_id);
    if (address && typeof address === "string") params.set("address", address);
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Geocode API request failed" });
  }
});

router.get("/places/reversegeocode", async (req, res) => {
  const { latlng } = req.query;
  if (!latlng || typeof latlng !== "string") {
    res.status(400).json({ error: "latlng query param required" });
    return;
  }
  try {
    const params = new URLSearchParams({ latlng, key: MAPS_KEY });
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Reverse geocode request failed" });
  }
});

router.get("/places/directions", async (req, res) => {
  const { origin, destination, waypoints } = req.query;
  if (!origin || !destination) {
    res.status(400).json({ error: "origin and destination required" });
    return;
  }
  try {
    const params = new URLSearchParams({
      origin: origin as string,
      destination: destination as string,
      key: MAPS_KEY,
    });
    if (waypoints && typeof waypoints === "string") {
      params.set("waypoints", waypoints);
    }
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Directions API request failed" });
  }
});

export default router;
