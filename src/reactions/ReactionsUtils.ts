import {
  Field,
  PrivateKey,
  PublicKey,
  MerkleMap,
  Poseidon,
  Signature,
  Bool,
  Mina,
  AccountUpdate,
} from 'o1js';
import { PostState } from '../posts/Posts';
import {
  ReactionState,
  fieldToFlagReactionsAsDeleted,
  fieldToFlagReactionsAsRestored,
} from './Reactions.js';
import { ReactionsContract } from './ReactionsContract';

export async function deployReactionsContract(
  deployerAddress: PublicKey,
  deployerKey: PrivateKey,
  reactionsContract: ReactionsContract,
  reactionsContractKey: PrivateKey
) {
  const txn = await Mina.transaction(deployerAddress, async () => {
    AccountUpdate.fundNewAccount(deployerAddress);
    reactionsContract.deploy();
  });
  await txn.prove();
  await txn.sign([deployerKey, reactionsContractKey]).send();
}

export function createReactionTransitionValidInputs(
  targetState: PostState,
  reactorAddress: PublicKey,
  reactorKey: PrivateKey,
  reactionCodePoint: Field,
  allReactionsCounter: Field,
  userReactionsCounter: Field,
  targetReactionsCounter: Field,
  reactionBlockHeight: Field,
  targetsMap: MerkleMap,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap
) {
  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const signature = Signature.create(reactorKey, [
    targetKey,
    reactionCodePoint,
  ]);

  const targets = targetsMap.getRoot();
  const targetWitness = targetsMap.getWitness(
    Poseidon.hash([posterAddressAsField, postContentIDHash])
  );

  const initialUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
  usersReactionsCountersMap.set(reactorAddressAsField, userReactionsCounter);
  const latestUsersReactionsCounters = usersReactionsCountersMap.getRoot();
  const userReactionsCounterWitness = usersReactionsCountersMap.getWitness(
    reactorAddressAsField
  );

  const initialTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  targetsReactionsCountersMap.set(targetKey, targetReactionsCounter);
  const latestTargetsReactionsCounters = targetsReactionsCountersMap.getRoot();
  const targetReactionsCounterWitness =
    targetsReactionsCountersMap.getWitness(targetKey);

  const reactionState = new ReactionState({
    isTargetPost: new Bool(true),
    targetKey: targetKey,
    reactorAddress: reactorAddress,
    reactionCodePoint: reactionCodePoint,
    allReactionsCounter: allReactionsCounter,
    userReactionsCounter: userReactionsCounter,
    targetReactionsCounter: targetReactionsCounter,
    reactionBlockHeight: reactionBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: Field(0),
  });

  const initialReactions = reactionsMap.getRoot();
  const reactionKey = Poseidon.hash([
    targetKey,
    reactorAddressAsField,
    reactionCodePoint,
  ]);
  reactionsMap.set(reactionKey, reactionState.hash());
  const latestReactions = reactionsMap.getRoot();
  const reactionWitness = reactionsMap.getWitness(reactionKey);

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    initialUsersReactionsCounters: initialUsersReactionsCounters,
    latestUsersReactionsCounters: latestUsersReactionsCounters,
    userReactionsCounterWitness: userReactionsCounterWitness,
    initialTargetsReactionsCounters: initialTargetsReactionsCounters,
    latestTargetsReactionsCounters: latestTargetsReactionsCounters,
    targetReactionsCounterWitness: targetReactionsCounterWitness,
    initialReactions: initialReactions,
    latestReactions: latestReactions,
    reactionWitness: reactionWitness,
    reactionState: reactionState,
  };
}

export function createReactionDeletionTransitionValidInputs(
  targetState: PostState,
  reactorKey: PrivateKey,
  allReactionsCounter: Field,
  initialReactionState: ReactionState,
  deletionBlockHeight: Field,
  targetsMap: MerkleMap,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap
) {
  const reactionStateHash = initialReactionState.hash();
  const signature = Signature.create(reactorKey, [
    reactionStateHash,
    fieldToFlagReactionsAsDeleted,
  ]);

  const targets = targetsMap.getRoot();
  const usersReactionsCounters = usersReactionsCountersMap.getRoot();
  const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const reactorAddressAsField = Poseidon.hash(
    initialReactionState.reactorAddress.toFields()
  );

  const initialReactions = reactionsMap.getRoot();

  const reactionKey = Poseidon.hash([
    targetKey,
    reactorAddressAsField,
    initialReactionState.reactionCodePoint,
  ]);
  const reactionWitness = reactionsMap.getWitness(reactionKey);

  const latestReactionState = new ReactionState({
    isTargetPost: new Bool(true),
    targetKey,
    reactorAddress: initialReactionState.reactorAddress,
    reactionCodePoint: initialReactionState.reactionCodePoint,
    allReactionsCounter: initialReactionState.allReactionsCounter,
    userReactionsCounter: initialReactionState.userReactionsCounter,
    targetReactionsCounter: initialReactionState.targetReactionsCounter,
    reactionBlockHeight: initialReactionState.reactionBlockHeight,
    deletionBlockHeight: deletionBlockHeight,
    restorationBlockHeight: initialReactionState.restorationBlockHeight,
  });

  reactionsMap.set(reactionKey, latestReactionState.hash());
  const latestReactions = reactionsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allReactionsCounter: allReactionsCounter,
    usersReactionsCounters: usersReactionsCounters,
    targetsReactionsCounters: targetsReactionsCounters,
    initialReactions: initialReactions,
    latestReactions: latestReactions,
    initialReactionState: initialReactionState,
    latestReactionState: latestReactionState,
    reactionWitness: reactionWitness,
  };
}

export function createReactionRestorationTransitionValidInputs(
  targetState: PostState,
  reactorKey: PrivateKey,
  allReactionsCounter: Field,
  initialReactionState: ReactionState,
  restorationBlockHeight: Field,
  targetsMap: MerkleMap,
  usersReactionsCountersMap: MerkleMap,
  targetsReactionsCountersMap: MerkleMap,
  reactionsMap: MerkleMap
) {
  const reactionStateHash = initialReactionState.hash();
  const signature = Signature.create(reactorKey, [
    reactionStateHash,
    fieldToFlagReactionsAsRestored,
  ]);

  const targets = targetsMap.getRoot();
  const usersReactionsCounters = usersReactionsCountersMap.getRoot();
  const targetsReactionsCounters = targetsReactionsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    targetState.posterAddress.toFields()
  );
  const postContentIDHash = targetState.postContentID.hash();
  const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

  const targetWitness = targetsMap.getWitness(targetKey);

  const reactorAddressAsField = Poseidon.hash(
    initialReactionState.reactorAddress.toFields()
  );

  const initialReactions = reactionsMap.getRoot();

  const reactionKey = Poseidon.hash([
    targetKey,
    reactorAddressAsField,
    initialReactionState.reactionCodePoint,
  ]);
  const reactionWitness = reactionsMap.getWitness(reactionKey);

  const latestReactionState = new ReactionState({
    isTargetPost: new Bool(true),
    targetKey,
    reactorAddress: initialReactionState.reactorAddress,
    reactionCodePoint: initialReactionState.reactionCodePoint,
    allReactionsCounter: initialReactionState.allReactionsCounter,
    userReactionsCounter: initialReactionState.userReactionsCounter,
    targetReactionsCounter: initialReactionState.targetReactionsCounter,
    reactionBlockHeight: initialReactionState.reactionBlockHeight,
    deletionBlockHeight: Field(0),
    restorationBlockHeight: restorationBlockHeight,
  });

  reactionsMap.set(reactionKey, latestReactionState.hash());
  const latestReactions = reactionsMap.getRoot();

  return {
    signature: signature,
    targets: targets,
    targetState: targetState,
    targetWitness: targetWitness,
    allReactionsCounter: allReactionsCounter,
    usersReactionsCounters: usersReactionsCounters,
    targetsReactionsCounters: targetsReactionsCounters,
    initialReactions: initialReactions,
    latestReactions: latestReactions,
    initialReactionState: initialReactionState,
    latestReactionState: latestReactionState,
    reactionWitness: reactionWitness,
  };
}
