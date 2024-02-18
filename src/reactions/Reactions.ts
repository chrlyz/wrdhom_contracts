import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  MerkleMapWitness,
  Bool,
  SelfProof,
} from 'o1js';
import { PostState } from '../posts/Posts.js';

// ============================================================================

export const fieldToFlagReactionsAsDeleted = Field(93137);
export const fieldToFlagReactionsAsRestored = Field(1010);

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

  static createReactionDeletionTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    allReactionsCounter: Field,
    usersReactionsCounters: Field,
    targetsReactionsCounters: Field,
    initialReactions: Field,
    latestReactions: Field,
    initialReactionState: ReactionState,
    reactionWitness: MerkleMapWitness,
    blockHeight: Field
  ) {
    initialReactionState.deletionBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKey(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(initialReactionState.targetKey);

    const initialReactionStateHash = initialReactionState.hash();
    const isSigned = signature.verify(initialReactionState.reactorAddress, [
      initialReactionStateHash,
      fieldToFlagReactionsAsDeleted,
    ]);
    isSigned.assertTrue();

    const reactionsBefore = reactionWitness.computeRootAndKey(
      initialReactionStateHash
    )[0];
    reactionsBefore.assertEquals(initialReactions);

    const latestReactionState = new ReactionState({
      isTargetPost: initialReactionState.isTargetPost,
      targetKey: initialReactionState.targetKey,
      reactorAddress: initialReactionState.reactorAddress,
      reactionCodePoint: initialReactionState.reactionCodePoint,
      allReactionsCounter: initialReactionState.allReactionsCounter,
      userReactionsCounter: initialReactionState.userReactionsCounter,
      targetReactionsCounter: initialReactionState.targetReactionsCounter,
      reactionBlockHeight: initialReactionState.reactionBlockHeight,
      deletionBlockHeight: blockHeight,
      restorationBlockHeight: initialReactionState.restorationBlockHeight,
    });

    const reactionsAfter = reactionWitness.computeRootAndKey(
      latestReactionState.hash()
    )[0];
    reactionsAfter.assertEquals(latestReactions);

    return new ReactionsTransition({
      targets: targetsRoot,
      initialAllReactionsCounter: allReactionsCounter,
      latestAllReactionsCounter: allReactionsCounter,
      initialUsersReactionsCounters: usersReactionsCounters,
      latestUsersReactionsCounters: usersReactionsCounters,
      initialTargetsReactionsCounters: targetsReactionsCounters,
      latestTargetsReactionsCounters: targetsReactionsCounters,
      initialReactions: initialReactions,
      latestReactions: reactionsAfter,
      blockHeight: blockHeight,
    });
  }

  static createReactionRestorationTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    allReactionsCounter: Field,
    usersReactionsCounters: Field,
    targetReactionsCounter: Field,
    initialReactions: Field,
    latestReactions: Field,
    initialReactionState: ReactionState,
    reactionWitness: MerkleMapWitness,
    blockHeight: Field
  ) {
    initialReactionState.deletionBlockHeight.assertNotEquals(0);

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKey(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(initialReactionState.targetKey);

    const initialReactionStateHash = initialReactionState.hash();
    const isSigned = signature.verify(initialReactionState.reactorAddress, [
      initialReactionStateHash,
      fieldToFlagReactionsAsRestored,
    ]);
    isSigned.assertTrue();

    const reactionsBefore = reactionWitness.computeRootAndKey(
      initialReactionStateHash
    )[0];
    reactionsBefore.assertEquals(initialReactions);

    const latestReactionState = new ReactionState({
      isTargetPost: initialReactionState.isTargetPost,
      targetKey: initialReactionState.targetKey,
      reactorAddress: initialReactionState.reactorAddress,
      reactionCodePoint: initialReactionState.reactionCodePoint,
      allReactionsCounter: initialReactionState.allReactionsCounter,
      userReactionsCounter: initialReactionState.userReactionsCounter,
      targetReactionsCounter: initialReactionState.targetReactionsCounter,
      reactionBlockHeight: initialReactionState.reactionBlockHeight,
      deletionBlockHeight: Field(0),
      restorationBlockHeight: blockHeight,
    });

    const reactionsAfter = reactionWitness.computeRootAndKey(
      latestReactionState.hash()
    )[0];
    reactionsAfter.assertEquals(latestReactions);

    return new ReactionsTransition({
      targets: targetsRoot,
      initialAllReactionsCounter: allReactionsCounter,
      latestAllReactionsCounter: allReactionsCounter,
      initialUsersReactionsCounters: usersReactionsCounters,
      latestUsersReactionsCounters: usersReactionsCounters,
      initialTargetsReactionsCounters: targetReactionsCounter,
      latestTargetsReactionsCounters: targetReactionsCounter,
      initialReactions: initialReactions,
      latestReactions: reactionsAfter,
      blockHeight: blockHeight,
    });
  }

  static mergeReactionsTransitions(
    transition1: ReactionsTransition,
    transition2: ReactionsTransition
  ) {
    transition1.targets.assertEquals(transition2.targets);
    transition1.latestAllReactionsCounter.assertEquals(
      transition2.initialAllReactionsCounter
    );
    transition1.latestUsersReactionsCounters.assertEquals(
      transition2.initialUsersReactionsCounters
    );
    transition1.latestTargetsReactionsCounters.assertEquals(
      transition2.initialTargetsReactionsCounters
    );
    transition1.latestReactions.assertEquals(transition2.initialReactions);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new ReactionsTransition({
      targets: transition1.targets,
      initialAllReactionsCounter: transition1.initialAllReactionsCounter,
      latestAllReactionsCounter: transition2.latestAllReactionsCounter,
      initialUsersReactionsCounters: transition1.initialUsersReactionsCounters,
      latestUsersReactionsCounters: transition2.latestUsersReactionsCounters,
      initialTargetsReactionsCounters:
        transition1.initialTargetsReactionsCounters,
      latestTargetsReactionsCounters:
        transition2.latestTargetsReactionsCounters,
      initialReactions: transition1.initialReactions,
      latestReactions: transition2.latestReactions,
      blockHeight: transition1.blockHeight,
    });
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

    proveReactionDeletionTransition: {
      privateInputs: [
        Signature,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        Field,
        Field,
        ReactionState,
        MerkleMapWitness,
        Field,
      ],

      method(
        transition: ReactionsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        allReactionsCounter: Field,
        usersReactionsCounters: Field,
        targetReactionsCounter: Field,
        initialReactions: Field,
        latestReactions: Field,
        initialReactionState: ReactionState,
        reactionWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition =
          ReactionsTransition.createReactionDeletionTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            allReactionsCounter,
            usersReactionsCounters,
            targetReactionsCounter,
            initialReactions,
            latestReactions,
            initialReactionState,
            reactionWitness,
            blockHeight
          );
        ReactionsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveReactionRestorationTransition: {
      privateInputs: [
        Signature,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        Field,
        Field,
        ReactionState,
        MerkleMapWitness,
        Field,
      ],

      method(
        transition: ReactionsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        allReactionsCounter: Field,
        usersReactionsCounters: Field,
        targetReactionsCounter: Field,
        initialReactions: Field,
        latestReactions: Field,
        initialReactionState: ReactionState,
        reactionWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition =
          ReactionsTransition.createReactionRestorationTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            allReactionsCounter,
            usersReactionsCounters,
            targetReactionsCounter,
            initialReactions,
            latestReactions,
            initialReactionState,
            reactionWitness,
            blockHeight
          );
        ReactionsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedReactionsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedReactionsTransitions: ReactionsTransition,
        reactionsTransition1Proof: SelfProof<ReactionsTransition, undefined>,
        reactionsTransition2Proof: SelfProof<ReactionsTransition, undefined>
      ) {
        reactionsTransition1Proof.verify();
        reactionsTransition2Proof.verify();

        const computedTransition =
          ReactionsTransition.mergeReactionsTransitions(
            reactionsTransition1Proof.publicInput,
            reactionsTransition2Proof.publicInput
          );
        ReactionsTransition.assertEquals(
          computedTransition,
          mergedReactionsTransitions
        );
      },
    },
  },
});

export let ReactionsProof_ = ZkProgram.Proof(Reactions);
export class ReactionsProof extends ReactionsProof_ {}

// ============================================================================
