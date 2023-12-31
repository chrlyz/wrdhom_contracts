import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  MerkleMapWitness,
  Bool,
} from 'o1js';
import { PostState } from '../posts/Posts.js';

// ============================================================================

export class ReactionState extends Struct({
  isTargetPost: Bool,
  targetKey: Field,
  reactorAddress: PublicKey,
  reactionCodePoint: Field,
  allReactionsCounter: Field,
  userReactionsCounter: Field,
  targetReactionsCounter: Field,
  reactionBlockHeight: Field,
  deletionBlockHeight: Field,
  restorationBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.isTargetPost
        .toFields()
        .concat(
          this.targetKey,
          this.reactorAddress
            .toFields()
            .concat([
              this.reactionCodePoint,
              this.allReactionsCounter,
              this.userReactionsCounter,
              this.targetReactionsCounter,
              this.reactionBlockHeight,
              this.deletionBlockHeight,
              this.restorationBlockHeight,
            ])
        )
    );
  }
}

// ============================================================================

export class ReactionsTransition extends Struct({
  targets: Field,
  initialAllReactionsCounter: Field,
  latestAllReactionsCounter: Field,
  initialUsersReactionsCounters: Field,
  latestUsersReactionsCounters: Field,
  initialTargetsReactionsCounters: Field,
  latestTargetsReactionsCounters: Field,
  initialReactions: Field,
  latestReactions: Field,
  blockHeight: Field,
}) {
  static createReactionPublishingTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    initialAllReactionsCounter: Field,
    initialUsersReactionsCounters: Field,
    latestUsersReactionsCounters: Field,
    initialUserReactionsCounter: Field,
    userReactionsCounterWitness: MerkleMapWitness,
    initialTargetsReactionsCounters: Field,
    latestTargetsReactionsCounters: Field,
    initialTargetReactionsCounter: Field,
    targetReactionsCounterWitness: MerkleMapWitness,
    initialReactions: Field,
    latestReactions: Field,
    reactionWitness: MerkleMapWitness,
    reactionState: ReactionState
  ) {
    initialAllReactionsCounter.assertEquals(
      reactionState.allReactionsCounter.sub(1)
    );
    reactionState.deletionBlockHeight.assertEquals(Field(0));
    reactionState.restorationBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKey(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(reactionState.targetKey);

    const isSigned = signature.verify(reactionState.reactorAddress, [
      targetKey,
      reactionState.reactionCodePoint,
    ]);
    isSigned.assertTrue();

    const [usersReactionsCountersBefore, userReactionsCounterKey] =
      userReactionsCounterWitness.computeRootAndKey(
        initialUserReactionsCounter
      );
    usersReactionsCountersBefore.assertEquals(initialUsersReactionsCounters);
    const reactorAddressAsField = Poseidon.hash(
      reactionState.reactorAddress.toFields()
    );
    userReactionsCounterKey.assertEquals(reactorAddressAsField);
    initialUserReactionsCounter.assertEquals(
      reactionState.userReactionsCounter.sub(1)
    );
    const usersReactionsCountersAfter =
      userReactionsCounterWitness.computeRootAndKey(
        reactionState.userReactionsCounter
      )[0];
    usersReactionsCountersAfter.assertEquals(latestUsersReactionsCounters);

    const [targetsReactionsCountersBefore, targetReactionsCounterKey] =
      targetReactionsCounterWitness.computeRootAndKey(
        initialTargetReactionsCounter
      );
    targetsReactionsCountersBefore.assertEquals(
      initialTargetsReactionsCounters
    );
    targetReactionsCounterKey.assertEquals(targetKey);
    initialTargetReactionsCounter.assertEquals(
      reactionState.targetReactionsCounter.sub(1)
    );
    const targetsReactionsCountersAfter =
      targetReactionsCounterWitness.computeRootAndKey(
        reactionState.targetReactionsCounter
      )[0];
    targetsReactionsCountersAfter.assertEquals(latestTargetsReactionsCounters);

    const [reactionsBefore, reactionKey] = reactionWitness.computeRootAndKey(
      Field(0)
    );
    reactionsBefore.assertEquals(initialReactions);
    reactionKey.assertEquals(
      Poseidon.hash([
        targetKey,
        reactorAddressAsField,
        reactionState.reactionCodePoint,
      ])
    );
    const reactionsAfter = reactionWitness.computeRootAndKey(
      reactionState.hash()
    )[0];
    reactionsAfter.assertEquals(latestReactions);

    return new ReactionsTransition({
      targets: targetsRoot,
      initialAllReactionsCounter: initialAllReactionsCounter,
      latestAllReactionsCounter: reactionState.allReactionsCounter,
      initialUsersReactionsCounters: usersReactionsCountersBefore,
      latestUsersReactionsCounters: usersReactionsCountersAfter,
      initialTargetsReactionsCounters: targetsReactionsCountersBefore,
      latestTargetsReactionsCounters: targetsReactionsCountersAfter,
      initialReactions: reactionsBefore,
      latestReactions: reactionsAfter,
      blockHeight: reactionState.reactionBlockHeight,
    });
  }

  static assertEquals(
    transition1: ReactionsTransition,
    transition2: ReactionsTransition
  ) {
    transition1.initialAllReactionsCounter.assertEquals(
      transition2.initialAllReactionsCounter
    );
    transition1.latestAllReactionsCounter.assertEquals(
      transition2.latestAllReactionsCounter
    );
    transition1.initialUsersReactionsCounters.assertEquals(
      transition2.initialUsersReactionsCounters
    );
    transition1.latestUsersReactionsCounters.assertEquals(
      transition2.latestUsersReactionsCounters
    );
    transition1.initialTargetsReactionsCounters.assertEquals(
      transition2.initialTargetsReactionsCounters
    );
    transition1.latestTargetsReactionsCounters.assertEquals(
      transition2.latestTargetsReactionsCounters
    );
    transition1.initialReactions.assertEquals(transition2.initialReactions);
    transition1.latestReactions.assertEquals(transition2.latestReactions);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }
}

// ============================================================================

export const Reactions = ZkProgram({
  name: 'Reactions',
  publicInput: ReactionsTransition,

  methods: {
    proveReactionPublishingTransition: {
      privateInputs: [
        Signature,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        MerkleMapWitness,
        ReactionState,
      ],

      method(
        transition: ReactionsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        initialAllReactionsCounter: Field,
        initialUsersReactionsCounters: Field,
        latestUsersReactionsCounters: Field,
        initialUserReactionsCounter: Field,
        userReactionsCounterWitness: MerkleMapWitness,
        initialTargetsReactionsCounters: Field,
        latestTargetsReactionsCounters: Field,
        initialTargetReactionsCounter: Field,
        targetReactionsCounterWitness: MerkleMapWitness,
        initialReactions: Field,
        latestReactions: Field,
        reactionWitness: MerkleMapWitness,
        reactionState: ReactionState
      ) {
        const computedTransition =
          ReactionsTransition.createReactionPublishingTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            initialAllReactionsCounter,
            initialUsersReactionsCounters,
            latestUsersReactionsCounters,
            initialUserReactionsCounter,
            userReactionsCounterWitness,
            initialTargetsReactionsCounters,
            latestTargetsReactionsCounters,
            initialTargetReactionsCounter,
            targetReactionsCounterWitness,
            initialReactions,
            latestReactions,
            reactionWitness,
            reactionState
          );
        ReactionsTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let ReactionsProof_ = ZkProgram.Proof(Reactions);
export class ReactionsProof extends ReactionsProof_ {}

// ============================================================================
