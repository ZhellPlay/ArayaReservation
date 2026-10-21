import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";

const app = initializeApp({
    apiKey: "AIzaSyCPK6T6zSkHtlATSWAlDsgU3oFP5ucPCU8",
    authDomain: "booking-a77e4.firebaseapp.com",
    projectId: "booking-a77e4",
    storageBucket: "booking-a77e4.firebasestorage.app",
    messagingSenderId: "80976845423",
    appId: "1:80976845423:web:d2ab3226a98c5e55de0b9a"
});

export const db = getFirestore(app);
export const auth = getAuth(app);
export {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
    onSnapshot, runTransaction, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
export { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
