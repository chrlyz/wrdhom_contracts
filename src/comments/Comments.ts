import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  MerkleMapWitness,
  Bool,
  CircuitString,
  SelfProof,
} from 'o1js';
import { PostState } from '../posts/Posts.js';

// ============================================================================

export const fieldToFlagCommentsAsDeleted = Field(93137);
export const fieldToFlagCommentsAsRestored = Field(1010);

// ============================================================================

export class CommentState extends Struct({
  isTargetPost: Bool,
  targetKey: Field,
  commenterAddress: PublicKey,
  commentContentID: CircuitString,
  allCommentsCounter: Field,
  userCommentsCounter: Field,
  targetCommentsCounter: Field,
  commentBlockHeight: Field,
  deletionBlockHeight: Field,
  restorationBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.isTargetPost
        .toFields()
        .concat(
          this.targetKey,
          this.commenterAddress
            .toFields()
            .concat([
              this.commentContentID.hash(),
              this.allCommentsCounter,
              this.userCommentsCounter,
              this.targetCommentsCounter,
              this.commentBlockHeight,
              this.deletionBlockHeight,
              this.restorationBlockHeight,
            ])
        )
    );
  }
}

// ============================================================================

export class CommentsTransition extends Struct({
  targets: Field,
  initialAllCommentsCounter: Field,
  latestAllCommentsCounter: Field,
  initialUsersCommentsCounters: Field,
  latestUsersCommentsCounters: Field,
  initialTargetsCommentsCounters: Field,
  latestTargetsCommentsCounters: Field,
  initialComments: Field,
  latestComments: Field,
  blockHeight: Field,
}) {
  static createCommentPublishingTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    initialAllCommentsCounter: Field,
    initialUsersCommentsCounters: Field,
    latestUsersCommentsCounters: Field,
    initialUserCommentsCounter: Field,
    userCommentsCounterWitness: MerkleMapWitness,
    initialTargetsCommentsCounters: Field,
    latestTargetsCommentsCounters: Field,
    initialTargetCommentsCounter: Field,
    targetCommentsCounterWitness: MerkleMapWitness,
    initialComments: Field,
    latestComments: Field,
    commentWitness: MerkleMapWitness,
    commentState: CommentState
  ) {
    initialAllCommentsCounter.assertEquals(
      commentState.allCommentsCounter.sub(1)
    );
    commentState.deletionBlockHeight.assertEquals(Field(0));
    commentState.restorationBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKeyV2(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(commentState.targetKey);

    const isSigned = signature.verify(commentState.commenterAddress, [
      targetKey,
      commentState.commentContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [usersCommentsCountersBefore, userCommentsCounterKey] =
      userCommentsCounterWitness.computeRootAndKeyV2(initialUserCommentsCounter);
    usersCommentsCountersBefore.assertEquals(initialUsersCommentsCounters);
    const commenterAddressAsField = Poseidon.hash(
      commentState.commenterAddress.toFields()
    );
    userCommentsCounterKey.assertEquals(commenterAddressAsField);
    initialUserCommentsCounter.assertEquals(
      commentState.userCommentsCounter.sub(1)
    );
    const usersCommentsCountersAfter =
      userCommentsCounterWitness.computeRootAndKeyV2(
        commentState.userCommentsCounter
      )[0];
    usersCommentsCountersAfter.assertEquals(latestUsersCommentsCounters);

    const [targetsCommentsCountersBefore, targetCommentsCounterKey] =
      targetCommentsCounterWitness.computeRootAndKeyV2(
        initialTargetCommentsCounter
      );
    targetsCommentsCountersBefore.assertEquals(initialTargetsCommentsCounters);
    targetCommentsCounterKey.assertEquals(targetKey);
    initialTargetCommentsCounter.assertEquals(
      commentState.targetCommentsCounter.sub(1)
    );
    const targetsCommentsCountersAfter =
      targetCommentsCounterWitness.computeRootAndKeyV2(
        commentState.targetCommentsCounter
      )[0];
    targetsCommentsCountersAfter.assertEquals(latestTargetsCommentsCounters);

    const [commentsBefore, commentKey] = commentWitness.computeRootAndKeyV2(
      Field(0)
    );
    commentsBefore.assertEquals(initialComments);
    commentKey.assertEquals(
      Poseidon.hash([
        targetKey,
        commenterAddressAsField,
        commentState.commentContentID.hash(),
      ])
    );
    const commentsAfter = commentWitness.computeRootAndKeyV2(
      commentState.hash()
    )[0];
    commentsAfter.assertEquals(latestComments);

    return new CommentsTransition({
      targets: targetsRoot,
      initialAllCommentsCounter: initialAllCommentsCounter,
      latestAllCommentsCounter: commentState.allCommentsCounter,
      initialUsersCommentsCounters: usersCommentsCountersBefore,
      latestUsersCommentsCounters: usersCommentsCountersAfter,
      initialTargetsCommentsCounters: targetsCommentsCountersBefore,
      latestTargetsCommentsCounters: targetsCommentsCountersAfter,
      initialComments: commentsBefore,
      latestComments: commentsAfter,
      blockHeight: commentState.commentBlockHeight,
    });
  }

  static assertEquals(
    transition1: CommentsTransition,
    transition2: CommentsTransition
  ) {
    transition1.initialAllCommentsCounter.assertEquals(
      transition2.initialAllCommentsCounter
    );
    transition1.latestAllCommentsCounter.assertEquals(
      transition2.latestAllCommentsCounter
    );
    transition1.initialUsersCommentsCounters.assertEquals(
      transition2.initialUsersCommentsCounters
    );
    transition1.latestUsersCommentsCounters.assertEquals(
      transition2.latestUsersCommentsCounters
    );
    transition1.initialTargetsCommentsCounters.assertEquals(
      transition2.initialTargetsCommentsCounters
    );
    transition1.latestTargetsCommentsCounters.assertEquals(
      transition2.latestTargetsCommentsCounters
    );
    transition1.initialComments.assertEquals(transition2.initialComments);
    transition1.latestComments.assertEquals(transition2.latestComments);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static createCommentDeletionTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    allCommentsCounter: Field,
    usersCommentsCounters: Field,
    targetsCommentsCounters: Field,
    initialComments: Field,
    latestComments: Field,
    initialCommentState: CommentState,
    commentWitness: MerkleMapWitness,
    blockHeight: Field
  ) {
    initialCommentState.deletionBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKeyV2(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(initialCommentState.targetKey);

    const initialCommentStateHash = initialCommentState.hash();
    const isSigned = signature.verify(initialCommentState.commenterAddress, [
      initialCommentStateHash,
      fieldToFlagCommentsAsDeleted,
    ]);
    isSigned.assertTrue();

    const commentsBefore = commentWitness.computeRootAndKeyV2(
      initialCommentStateHash
    )[0];
    commentsBefore.assertEquals(initialComments);

    const latestCommentState = new CommentState({
      isTargetPost: initialCommentState.isTargetPost,
      targetKey: initialCommentState.targetKey,
      commenterAddress: initialCommentState.commenterAddress,
      commentContentID: initialCommentState.commentContentID,
      allCommentsCounter: initialCommentState.allCommentsCounter,
      userCommentsCounter: initialCommentState.userCommentsCounter,
      targetCommentsCounter: initialCommentState.targetCommentsCounter,
      commentBlockHeight: initialCommentState.commentBlockHeight,
      deletionBlockHeight: blockHeight,
      restorationBlockHeight: initialCommentState.restorationBlockHeight,
    });

    const commentsAfter = commentWitness.computeRootAndKeyV2(
      latestCommentState.hash()
    )[0];
    commentsAfter.assertEquals(latestComments);

    return new CommentsTransition({
      targets: targetsRoot,
      initialAllCommentsCounter: allCommentsCounter,
      latestAllCommentsCounter: allCommentsCounter,
      initialUsersCommentsCounters: usersCommentsCounters,
      latestUsersCommentsCounters: usersCommentsCounters,
      initialTargetsCommentsCounters: targetsCommentsCounters,
      latestTargetsCommentsCounters: targetsCommentsCounters,
      initialComments: initialComments,
      latestComments: commentsAfter,
      blockHeight: blockHeight,
    });
  }

  static createCommentRestorationTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    allCommentsCounter: Field,
    usersCommentsCounters: Field,
    targetCommentsCounter: Field,
    initialComments: Field,
    latestComments: Field,
    initialCommentState: CommentState,
    commentWitness: MerkleMapWitness,
    blockHeight: Field
  ) {
    initialCommentState.deletionBlockHeight.assertNotEquals(0);

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKeyV2(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(initialCommentState.targetKey);

    const initialCommentStateHash = initialCommentState.hash();
    const isSigned = signature.verify(initialCommentState.commenterAddress, [
      initialCommentStateHash,
      fieldToFlagCommentsAsRestored,
    ]);
    isSigned.assertTrue();

    const commentsBefore = commentWitness.computeRootAndKeyV2(
      initialCommentStateHash
    )[0];
    commentsBefore.assertEquals(initialComments);

    const latestCommentState = new CommentState({
      isTargetPost: initialCommentState.isTargetPost,
      targetKey: initialCommentState.targetKey,
      commenterAddress: initialCommentState.commenterAddress,
      commentContentID: initialCommentState.commentContentID,
      allCommentsCounter: initialCommentState.allCommentsCounter,
      userCommentsCounter: initialCommentState.userCommentsCounter,
      targetCommentsCounter: initialCommentState.targetCommentsCounter,
      commentBlockHeight: initialCommentState.commentBlockHeight,
      deletionBlockHeight: Field(0),
      restorationBlockHeight: blockHeight,
    });

    const commentsAfter = commentWitness.computeRootAndKeyV2(
      latestCommentState.hash()
    )[0];
    commentsAfter.assertEquals(latestComments);

    return new CommentsTransition({
      targets: targetsRoot,
      initialAllCommentsCounter: allCommentsCounter,
      latestAllCommentsCounter: allCommentsCounter,
      initialUsersCommentsCounters: usersCommentsCounters,
      latestUsersCommentsCounters: usersCommentsCounters,
      initialTargetsCommentsCounters: targetCommentsCounter,
      latestTargetsCommentsCounters: targetCommentsCounter,
      initialComments: initialComments,
      latestComments: commentsAfter,
      blockHeight: blockHeight,
    });
  }

  static mergeCommentsTransitions(
    transition1: CommentsTransition,
    transition2: CommentsTransition
  ) {
    transition1.targets.assertEquals(transition2.targets);
    transition1.latestAllCommentsCounter.assertEquals(
      transition2.initialAllCommentsCounter
    );
    transition1.latestUsersCommentsCounters.assertEquals(
      transition2.initialUsersCommentsCounters
    );
    transition1.latestTargetsCommentsCounters.assertEquals(
      transition2.initialTargetsCommentsCounters
    );
    transition1.latestComments.assertEquals(transition2.initialComments);
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new CommentsTransition({
      targets: transition1.targets,
      initialAllCommentsCounter: transition1.initialAllCommentsCounter,
      latestAllCommentsCounter: transition2.latestAllCommentsCounter,
      initialUsersCommentsCounters: transition1.initialUsersCommentsCounters,
      latestUsersCommentsCounters: transition2.latestUsersCommentsCounters,
      initialTargetsCommentsCounters:
        transition1.initialTargetsCommentsCounters,
      latestTargetsCommentsCounters: transition2.latestTargetsCommentsCounters,
      initialComments: transition1.initialComments,
      latestComments: transition2.latestComments,
      blockHeight: transition1.blockHeight,
    });
  }
}

// ============================================================================

export const Comments = ZkProgram({
  name: 'Comments',
  publicInput: CommentsTransition,

  methods: {
    proveCommentPublishingTransition: {
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
        CommentState,
      ],

      async method(
        transition: CommentsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        initialAllCommentsCounter: Field,
        initialUsersCommentsCounters: Field,
        latestUsersCommentsCounters: Field,
        initialUserCommentsCounter: Field,
        userCommentsCounterWitness: MerkleMapWitness,
        initialTargetsCommentsCounters: Field,
        latestTargetsCommentsCounters: Field,
        initialTargetCommentsCounter: Field,
        targetCommentsCounterWitness: MerkleMapWitness,
        initialComments: Field,
        latestComments: Field,
        commentWitness: MerkleMapWitness,
        commentState: CommentState
      ) {
        const computedTransition =
          CommentsTransition.createCommentPublishingTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            initialAllCommentsCounter,
            initialUsersCommentsCounters,
            latestUsersCommentsCounters,
            initialUserCommentsCounter,
            userCommentsCounterWitness,
            initialTargetsCommentsCounters,
            latestTargetsCommentsCounters,
            initialTargetCommentsCounter,
            targetCommentsCounterWitness,
            initialComments,
            latestComments,
            commentWitness,
            commentState
          );
        CommentsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveCommentDeletionTransition: {
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
        CommentState,
        MerkleMapWitness,
        Field,
      ],

      async method(
        transition: CommentsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        allCommentsCounter: Field,
        usersCommentsCounters: Field,
        targetCommentsCounter: Field,
        initialComments: Field,
        latestComments: Field,
        initialCommentState: CommentState,
        reactionWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition =
          CommentsTransition.createCommentDeletionTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            allCommentsCounter,
            usersCommentsCounters,
            targetCommentsCounter,
            initialComments,
            latestComments,
            initialCommentState,
            reactionWitness,
            blockHeight
          );
        CommentsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveCommentRestorationTransition: {
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
        CommentState,
        MerkleMapWitness,
        Field,
      ],

      async method(
        transition: CommentsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        allCommentsCounter: Field,
        usersCommentsCounters: Field,
        targetCommentsCounter: Field,
        initialComments: Field,
        latestComments: Field,
        initialCommentState: CommentState,
        reactionWitness: MerkleMapWitness,
        blockHeight: Field
      ) {
        const computedTransition =
          CommentsTransition.createCommentRestorationTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            allCommentsCounter,
            usersCommentsCounters,
            targetCommentsCounter,
            initialComments,
            latestComments,
            initialCommentState,
            reactionWitness,
            blockHeight
          );
        CommentsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedCommentsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      async method(
        mergedCommentsTransitions: CommentsTransition,
        commentsTransition1Proof: SelfProof<CommentsTransition, undefined>,
        commentsTransition2Proof: SelfProof<CommentsTransition, undefined>
      ) {
        commentsTransition1Proof.verify();
        commentsTransition2Proof.verify();

        const computedTransition = CommentsTransition.mergeCommentsTransitions(
          commentsTransition1Proof.publicInput,
          commentsTransition2Proof.publicInput
        );
        CommentsTransition.assertEquals(
          computedTransition,
          mergedCommentsTransitions
        );
      },
    },
  },
});

export let CommentsProof_ = ZkProgram.Proof(Comments);
export class CommentsProof extends CommentsProof_ {}

// ============================================================================
