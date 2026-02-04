# SearchEventsRequestFilters

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Channel** | Pointer to **[]string** | Channel types | [optional] 
**InstanceId** | Pointer to **string** | Instance UUID | [optional] 
**PersonId** | Pointer to **string** | Person UUID | [optional] 
**EventType** | Pointer to **[]string** | Event types | [optional] 
**ContentType** | Pointer to **[]string** | Content types | [optional] 
**Direction** | Pointer to **string** | Direction | [optional] 
**Since** | Pointer to **time.Time** | Start date | [optional] 
**Until** | Pointer to **time.Time** | End date | [optional] 

## Methods

### NewSearchEventsRequestFilters

`func NewSearchEventsRequestFilters() *SearchEventsRequestFilters`

NewSearchEventsRequestFilters instantiates a new SearchEventsRequestFilters object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSearchEventsRequestFiltersWithDefaults

`func NewSearchEventsRequestFiltersWithDefaults() *SearchEventsRequestFilters`

NewSearchEventsRequestFiltersWithDefaults instantiates a new SearchEventsRequestFilters object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetChannel

`func (o *SearchEventsRequestFilters) GetChannel() []string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *SearchEventsRequestFilters) GetChannelOk() (*[]string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *SearchEventsRequestFilters) SetChannel(v []string)`

SetChannel sets Channel field to given value.

### HasChannel

`func (o *SearchEventsRequestFilters) HasChannel() bool`

HasChannel returns a boolean if a field has been set.

### GetInstanceId

`func (o *SearchEventsRequestFilters) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *SearchEventsRequestFilters) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *SearchEventsRequestFilters) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.

### HasInstanceId

`func (o *SearchEventsRequestFilters) HasInstanceId() bool`

HasInstanceId returns a boolean if a field has been set.

### GetPersonId

`func (o *SearchEventsRequestFilters) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *SearchEventsRequestFilters) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *SearchEventsRequestFilters) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.

### HasPersonId

`func (o *SearchEventsRequestFilters) HasPersonId() bool`

HasPersonId returns a boolean if a field has been set.

### GetEventType

`func (o *SearchEventsRequestFilters) GetEventType() []string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *SearchEventsRequestFilters) GetEventTypeOk() (*[]string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *SearchEventsRequestFilters) SetEventType(v []string)`

SetEventType sets EventType field to given value.

### HasEventType

`func (o *SearchEventsRequestFilters) HasEventType() bool`

HasEventType returns a boolean if a field has been set.

### GetContentType

`func (o *SearchEventsRequestFilters) GetContentType() []string`

GetContentType returns the ContentType field if non-nil, zero value otherwise.

### GetContentTypeOk

`func (o *SearchEventsRequestFilters) GetContentTypeOk() (*[]string, bool)`

GetContentTypeOk returns a tuple with the ContentType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContentType

`func (o *SearchEventsRequestFilters) SetContentType(v []string)`

SetContentType sets ContentType field to given value.

### HasContentType

`func (o *SearchEventsRequestFilters) HasContentType() bool`

HasContentType returns a boolean if a field has been set.

### GetDirection

`func (o *SearchEventsRequestFilters) GetDirection() string`

GetDirection returns the Direction field if non-nil, zero value otherwise.

### GetDirectionOk

`func (o *SearchEventsRequestFilters) GetDirectionOk() (*string, bool)`

GetDirectionOk returns a tuple with the Direction field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDirection

`func (o *SearchEventsRequestFilters) SetDirection(v string)`

SetDirection sets Direction field to given value.

### HasDirection

`func (o *SearchEventsRequestFilters) HasDirection() bool`

HasDirection returns a boolean if a field has been set.

### GetSince

`func (o *SearchEventsRequestFilters) GetSince() time.Time`

GetSince returns the Since field if non-nil, zero value otherwise.

### GetSinceOk

`func (o *SearchEventsRequestFilters) GetSinceOk() (*time.Time, bool)`

GetSinceOk returns a tuple with the Since field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSince

`func (o *SearchEventsRequestFilters) SetSince(v time.Time)`

SetSince sets Since field to given value.

### HasSince

`func (o *SearchEventsRequestFilters) HasSince() bool`

HasSince returns a boolean if a field has been set.

### GetUntil

`func (o *SearchEventsRequestFilters) GetUntil() time.Time`

GetUntil returns the Until field if non-nil, zero value otherwise.

### GetUntilOk

`func (o *SearchEventsRequestFilters) GetUntilOk() (*time.Time, bool)`

GetUntilOk returns a tuple with the Until field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUntil

`func (o *SearchEventsRequestFilters) SetUntil(v time.Time)`

SetUntil sets Until field to given value.

### HasUntil

`func (o *SearchEventsRequestFilters) HasUntil() bool`

HasUntil returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


