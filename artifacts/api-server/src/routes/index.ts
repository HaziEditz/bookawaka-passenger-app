import { Router, type IRouter } from "express";
import healthRouter from "./health";
import placesRouter from "./places";
import stripeRouter from "./stripe";
import emailRouter from "./email";
import bookingRouter from "./booking";

const router: IRouter = Router();

router.use(healthRouter);
router.use(placesRouter);
router.use(stripeRouter);
router.use(emailRouter);
router.use("/booking", bookingRouter);

export default router;
