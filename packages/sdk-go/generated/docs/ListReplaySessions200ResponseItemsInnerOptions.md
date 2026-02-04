# ListReplaySessions200ResponseItemsInnerOptions

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Since** | **time.Time** | Start date (required) | 
**Until** | Pointer to **time.Time** | End date | [optional] 
**EventTypes** | Pointer to **[]string** | Event types to replay | [optional] 
**InstanceId** | Pointer to **string** | Filter by instance | [optional] 
**Limit** | Pointer to **int32** | Max events | [optional] 
**SpeedMultiplier** | Pointer to **float32** | Replay speed | [optional] 
**SkipProcessed** | Pointer to **bool** | Skip already processed | [optional] 
**DryRun** | Pointer to **bool** | Dry run mode | [optional] 

## Methods

### NewListReplaySessions200ResponseItemsInnerOptions

`func NewListReplaySessions200ResponseItemsInnerOptions(since time.Time, ) *ListReplaySessions200ResponseItemsInnerOptions`

NewListReplaySessions200ResponseItemsInnerOptions instantiates a new ListReplaySessions200ResponseItemsInnerOptions object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListReplaySessions200ResponseItemsInnerOptionsWithDefaults

`func NewListReplaySessions200ResponseItemsInnerOptionsWithDefaults() *ListReplaySessions200ResponseItemsInnerOptions`

NewListReplaySessions200ResponseItemsInnerOptionsWithDefaults instantiates a new ListReplaySessions200ResponseItemsInnerOptions object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSince

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSince() time.Time`

GetSince returns the Since field if non-nil, zero value otherwise.

### GetSinceOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSinceOk() (*time.Time, bool)`

GetSinceOk returns a tuple with the Since field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSince

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetSince(v time.Time)`

SetSince sets Since field to given value.


### GetUntil

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetUntil() time.Time`

GetUntil returns the Until field if non-nil, zero value otherwise.

### GetUntilOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetUntilOk() (*time.Time, bool)`

GetUntilOk returns a tuple with the Until field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUntil

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetUntil(v time.Time)`

SetUntil sets Until field to given value.

### HasUntil

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasUntil() bool`

HasUntil returns a boolean if a field has been set.

### GetEventTypes

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetEventTypes() []string`

GetEventTypes returns the EventTypes field if non-nil, zero value otherwise.

### GetEventTypesOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetEventTypesOk() (*[]string, bool)`

GetEventTypesOk returns a tuple with the EventTypes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventTypes

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetEventTypes(v []string)`

SetEventTypes sets EventTypes field to given value.

### HasEventTypes

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasEventTypes() bool`

HasEventTypes returns a boolean if a field has been set.

### GetInstanceId

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### GetLimit

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasLimit() bool`

HasLimit returns a boolean if a field has been set.

### GetSpeedMultiplier

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSpeedMultiplier() float32`

GetSpeedMultiplier returns the SpeedMultiplier field if non-nil, zero value otherwise.

### GetSpeedMultiplierOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSpeedMultiplierOk() (*float32, bool)`

GetSpeedMultiplierOk returns a tuple with the SpeedMultiplier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSpeedMultiplier

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetSpeedMultiplier(v float32)`

SetSpeedMultiplier sets SpeedMultiplier field to given value.

### HasSpeedMultiplier

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasSpeedMultiplier() bool`

HasSpeedMultiplier returns a boolean if a field has been set.

### GetSkipProcessed

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSkipProcessed() bool`

GetSkipProcessed returns the SkipProcessed field if non-nil, zero value otherwise.

### GetSkipProcessedOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetSkipProcessedOk() (*bool, bool)`

GetSkipProcessedOk returns a tuple with the SkipProcessed field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSkipProcessed

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetSkipProcessed(v bool)`

SetSkipProcessed sets SkipProcessed field to given value.

### HasSkipProcessed

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasSkipProcessed() bool`

HasSkipProcessed returns a boolean if a field has been set.

### GetDryRun

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetDryRun() bool`

GetDryRun returns the DryRun field if non-nil, zero value otherwise.

### GetDryRunOk

`func (o *ListReplaySessions200ResponseItemsInnerOptions) GetDryRunOk() (*bool, bool)`

GetDryRunOk returns a tuple with the DryRun field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDryRun

`func (o *ListReplaySessions200ResponseItemsInnerOptions) SetDryRun(v bool)`

SetDryRun sets DryRun field to given value.

### HasDryRun

`func (o *ListReplaySessions200ResponseItemsInnerOptions) HasDryRun() bool`

HasDryRun returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


