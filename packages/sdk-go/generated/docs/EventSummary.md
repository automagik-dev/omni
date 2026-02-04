# EventSummary

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Event UUID | 
**EventType** | **string** | Event type | 
**ContentType** | **NullableString** | Content type | 
**ReceivedAt** | **time.Time** | When event was received | 
**TextPreview** | **NullableString** | First 100 chars of text | 

## Methods

### NewEventSummary

`func NewEventSummary(id string, eventType string, contentType NullableString, receivedAt time.Time, textPreview NullableString, ) *EventSummary`

NewEventSummary instantiates a new EventSummary object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewEventSummaryWithDefaults

`func NewEventSummaryWithDefaults() *EventSummary`

NewEventSummaryWithDefaults instantiates a new EventSummary object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *EventSummary) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *EventSummary) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *EventSummary) SetId(v string)`

SetId sets Id field to given value.


### GetEventType

`func (o *EventSummary) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *EventSummary) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *EventSummary) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetContentType

`func (o *EventSummary) GetContentType() string`

GetContentType returns the ContentType field if non-nil, zero value otherwise.

### GetContentTypeOk

`func (o *EventSummary) GetContentTypeOk() (*string, bool)`

GetContentTypeOk returns a tuple with the ContentType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContentType

`func (o *EventSummary) SetContentType(v string)`

SetContentType sets ContentType field to given value.


### SetContentTypeNil

`func (o *EventSummary) SetContentTypeNil(b bool)`

 SetContentTypeNil sets the value for ContentType to be an explicit nil

### UnsetContentType
`func (o *EventSummary) UnsetContentType()`

UnsetContentType ensures that no value is present for ContentType, not even an explicit nil
### GetReceivedAt

`func (o *EventSummary) GetReceivedAt() time.Time`

GetReceivedAt returns the ReceivedAt field if non-nil, zero value otherwise.

### GetReceivedAtOk

`func (o *EventSummary) GetReceivedAtOk() (*time.Time, bool)`

GetReceivedAtOk returns a tuple with the ReceivedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReceivedAt

`func (o *EventSummary) SetReceivedAt(v time.Time)`

SetReceivedAt sets ReceivedAt field to given value.


### GetTextPreview

`func (o *EventSummary) GetTextPreview() string`

GetTextPreview returns the TextPreview field if non-nil, zero value otherwise.

### GetTextPreviewOk

`func (o *EventSummary) GetTextPreviewOk() (*string, bool)`

GetTextPreviewOk returns a tuple with the TextPreview field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTextPreview

`func (o *EventSummary) SetTextPreview(v string)`

SetTextPreview sets TextPreview field to given value.


### SetTextPreviewNil

`func (o *EventSummary) SetTextPreviewNil(b bool)`

 SetTextPreviewNil sets the value for TextPreview to be an explicit nil

### UnsetTextPreview
`func (o *EventSummary) UnsetTextPreview()`

UnsetTextPreview ensures that no value is present for TextPreview, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


