# ScheduledOpsResult

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**DeadLetterRetry** | [**RunScheduledOps200ResponseDataDeadLetterRetry**](RunScheduledOps200ResponseDataDeadLetterRetry.md) |  | 
**PayloadCleanup** | [**RunScheduledOps200ResponseDataPayloadCleanup**](RunScheduledOps200ResponseDataPayloadCleanup.md) |  | 

## Methods

### NewScheduledOpsResult

`func NewScheduledOpsResult(deadLetterRetry RunScheduledOps200ResponseDataDeadLetterRetry, payloadCleanup RunScheduledOps200ResponseDataPayloadCleanup, ) *ScheduledOpsResult`

NewScheduledOpsResult instantiates a new ScheduledOpsResult object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewScheduledOpsResultWithDefaults

`func NewScheduledOpsResultWithDefaults() *ScheduledOpsResult`

NewScheduledOpsResultWithDefaults instantiates a new ScheduledOpsResult object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetDeadLetterRetry

`func (o *ScheduledOpsResult) GetDeadLetterRetry() RunScheduledOps200ResponseDataDeadLetterRetry`

GetDeadLetterRetry returns the DeadLetterRetry field if non-nil, zero value otherwise.

### GetDeadLetterRetryOk

`func (o *ScheduledOpsResult) GetDeadLetterRetryOk() (*RunScheduledOps200ResponseDataDeadLetterRetry, bool)`

GetDeadLetterRetryOk returns a tuple with the DeadLetterRetry field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDeadLetterRetry

`func (o *ScheduledOpsResult) SetDeadLetterRetry(v RunScheduledOps200ResponseDataDeadLetterRetry)`

SetDeadLetterRetry sets DeadLetterRetry field to given value.


### GetPayloadCleanup

`func (o *ScheduledOpsResult) GetPayloadCleanup() RunScheduledOps200ResponseDataPayloadCleanup`

GetPayloadCleanup returns the PayloadCleanup field if non-nil, zero value otherwise.

### GetPayloadCleanupOk

`func (o *ScheduledOpsResult) GetPayloadCleanupOk() (*RunScheduledOps200ResponseDataPayloadCleanup, bool)`

GetPayloadCleanupOk returns a tuple with the PayloadCleanup field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayloadCleanup

`func (o *ScheduledOpsResult) SetPayloadCleanup(v RunScheduledOps200ResponseDataPayloadCleanup)`

SetPayloadCleanup sets PayloadCleanup field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


