# DeadLetter

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Dead letter UUID | 
**EventId** | **string** | Original event UUID | 
**EventType** | **string** | Event type | 
**Status** | **string** | Status | 
**ErrorMessage** | **string** | Error message | 
**ErrorStack** | **NullableString** | Error stack trace | 
**RetryCount** | **int32** | Retry attempts | 
**LastRetryAt** | **NullableTime** | Last retry timestamp | 
**ResolvedAt** | **NullableTime** | Resolution timestamp | 
**ResolutionNote** | **NullableString** | Resolution note | 
**CreatedAt** | **time.Time** | Creation timestamp | 

## Methods

### NewDeadLetter

`func NewDeadLetter(id string, eventId string, eventType string, status string, errorMessage string, errorStack NullableString, retryCount int32, lastRetryAt NullableTime, resolvedAt NullableTime, resolutionNote NullableString, createdAt time.Time, ) *DeadLetter`

NewDeadLetter instantiates a new DeadLetter object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewDeadLetterWithDefaults

`func NewDeadLetterWithDefaults() *DeadLetter`

NewDeadLetterWithDefaults instantiates a new DeadLetter object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *DeadLetter) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *DeadLetter) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *DeadLetter) SetId(v string)`

SetId sets Id field to given value.


### GetEventId

`func (o *DeadLetter) GetEventId() string`

GetEventId returns the EventId field if non-nil, zero value otherwise.

### GetEventIdOk

`func (o *DeadLetter) GetEventIdOk() (*string, bool)`

GetEventIdOk returns a tuple with the EventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventId

`func (o *DeadLetter) SetEventId(v string)`

SetEventId sets EventId field to given value.


### GetEventType

`func (o *DeadLetter) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *DeadLetter) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *DeadLetter) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetStatus

`func (o *DeadLetter) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *DeadLetter) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *DeadLetter) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetErrorMessage

`func (o *DeadLetter) GetErrorMessage() string`

GetErrorMessage returns the ErrorMessage field if non-nil, zero value otherwise.

### GetErrorMessageOk

`func (o *DeadLetter) GetErrorMessageOk() (*string, bool)`

GetErrorMessageOk returns a tuple with the ErrorMessage field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetErrorMessage

`func (o *DeadLetter) SetErrorMessage(v string)`

SetErrorMessage sets ErrorMessage field to given value.


### GetErrorStack

`func (o *DeadLetter) GetErrorStack() string`

GetErrorStack returns the ErrorStack field if non-nil, zero value otherwise.

### GetErrorStackOk

`func (o *DeadLetter) GetErrorStackOk() (*string, bool)`

GetErrorStackOk returns a tuple with the ErrorStack field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetErrorStack

`func (o *DeadLetter) SetErrorStack(v string)`

SetErrorStack sets ErrorStack field to given value.


### SetErrorStackNil

`func (o *DeadLetter) SetErrorStackNil(b bool)`

 SetErrorStackNil sets the value for ErrorStack to be an explicit nil

### UnsetErrorStack
`func (o *DeadLetter) UnsetErrorStack()`

UnsetErrorStack ensures that no value is present for ErrorStack, not even an explicit nil
### GetRetryCount

`func (o *DeadLetter) GetRetryCount() int32`

GetRetryCount returns the RetryCount field if non-nil, zero value otherwise.

### GetRetryCountOk

`func (o *DeadLetter) GetRetryCountOk() (*int32, bool)`

GetRetryCountOk returns a tuple with the RetryCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryCount

`func (o *DeadLetter) SetRetryCount(v int32)`

SetRetryCount sets RetryCount field to given value.


### GetLastRetryAt

`func (o *DeadLetter) GetLastRetryAt() time.Time`

GetLastRetryAt returns the LastRetryAt field if non-nil, zero value otherwise.

### GetLastRetryAtOk

`func (o *DeadLetter) GetLastRetryAtOk() (*time.Time, bool)`

GetLastRetryAtOk returns a tuple with the LastRetryAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastRetryAt

`func (o *DeadLetter) SetLastRetryAt(v time.Time)`

SetLastRetryAt sets LastRetryAt field to given value.


### SetLastRetryAtNil

`func (o *DeadLetter) SetLastRetryAtNil(b bool)`

 SetLastRetryAtNil sets the value for LastRetryAt to be an explicit nil

### UnsetLastRetryAt
`func (o *DeadLetter) UnsetLastRetryAt()`

UnsetLastRetryAt ensures that no value is present for LastRetryAt, not even an explicit nil
### GetResolvedAt

`func (o *DeadLetter) GetResolvedAt() time.Time`

GetResolvedAt returns the ResolvedAt field if non-nil, zero value otherwise.

### GetResolvedAtOk

`func (o *DeadLetter) GetResolvedAtOk() (*time.Time, bool)`

GetResolvedAtOk returns a tuple with the ResolvedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolvedAt

`func (o *DeadLetter) SetResolvedAt(v time.Time)`

SetResolvedAt sets ResolvedAt field to given value.


### SetResolvedAtNil

`func (o *DeadLetter) SetResolvedAtNil(b bool)`

 SetResolvedAtNil sets the value for ResolvedAt to be an explicit nil

### UnsetResolvedAt
`func (o *DeadLetter) UnsetResolvedAt()`

UnsetResolvedAt ensures that no value is present for ResolvedAt, not even an explicit nil
### GetResolutionNote

`func (o *DeadLetter) GetResolutionNote() string`

GetResolutionNote returns the ResolutionNote field if non-nil, zero value otherwise.

### GetResolutionNoteOk

`func (o *DeadLetter) GetResolutionNoteOk() (*string, bool)`

GetResolutionNoteOk returns a tuple with the ResolutionNote field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResolutionNote

`func (o *DeadLetter) SetResolutionNote(v string)`

SetResolutionNote sets ResolutionNote field to given value.


### SetResolutionNoteNil

`func (o *DeadLetter) SetResolutionNoteNil(b bool)`

 SetResolutionNoteNil sets the value for ResolutionNote to be an explicit nil

### UnsetResolutionNote
`func (o *DeadLetter) UnsetResolutionNote()`

UnsetResolutionNote ensures that no value is present for ResolutionNote, not even an explicit nil
### GetCreatedAt

`func (o *DeadLetter) GetCreatedAt() time.Time`

GetCreatedAt returns the CreatedAt field if non-nil, zero value otherwise.

### GetCreatedAtOk

`func (o *DeadLetter) GetCreatedAtOk() (*time.Time, bool)`

GetCreatedAtOk returns a tuple with the CreatedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCreatedAt

`func (o *DeadLetter) SetCreatedAt(v time.Time)`

SetCreatedAt sets CreatedAt field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


