# Event

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Event UUID | 
**EventType** | **string** | Event type | 
**ContentType** | **NullableString** | Content type | 
**InstanceId** | **string** | Instance UUID | 
**PersonId** | **NullableString** | Person UUID | 
**Direction** | **string** | Message direction | 
**TextContent** | **NullableString** | Text content | 
**Transcription** | **NullableString** | Audio transcription | 
**ImageDescription** | **NullableString** | Image description | 
**ReceivedAt** | **time.Time** | When event was received | 
**ProcessedAt** | **NullableTime** | When event was processed | 

## Methods

### NewEvent

`func NewEvent(id string, eventType string, contentType NullableString, instanceId string, personId NullableString, direction string, textContent NullableString, transcription NullableString, imageDescription NullableString, receivedAt time.Time, processedAt NullableTime, ) *Event`

NewEvent instantiates a new Event object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewEventWithDefaults

`func NewEventWithDefaults() *Event`

NewEventWithDefaults instantiates a new Event object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Event) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Event) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Event) SetId(v string)`

SetId sets Id field to given value.


### GetEventType

`func (o *Event) GetEventType() string`

GetEventType returns the EventType field if non-nil, zero value otherwise.

### GetEventTypeOk

`func (o *Event) GetEventTypeOk() (*string, bool)`

GetEventTypeOk returns a tuple with the EventType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEventType

`func (o *Event) SetEventType(v string)`

SetEventType sets EventType field to given value.


### GetContentType

`func (o *Event) GetContentType() string`

GetContentType returns the ContentType field if non-nil, zero value otherwise.

### GetContentTypeOk

`func (o *Event) GetContentTypeOk() (*string, bool)`

GetContentTypeOk returns a tuple with the ContentType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContentType

`func (o *Event) SetContentType(v string)`

SetContentType sets ContentType field to given value.


### SetContentTypeNil

`func (o *Event) SetContentTypeNil(b bool)`

 SetContentTypeNil sets the value for ContentType to be an explicit nil

### UnsetContentType
`func (o *Event) UnsetContentType()`

UnsetContentType ensures that no value is present for ContentType, not even an explicit nil
### GetInstanceId

`func (o *Event) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *Event) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *Event) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetPersonId

`func (o *Event) GetPersonId() string`

GetPersonId returns the PersonId field if non-nil, zero value otherwise.

### GetPersonIdOk

`func (o *Event) GetPersonIdOk() (*string, bool)`

GetPersonIdOk returns a tuple with the PersonId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPersonId

`func (o *Event) SetPersonId(v string)`

SetPersonId sets PersonId field to given value.


### SetPersonIdNil

`func (o *Event) SetPersonIdNil(b bool)`

 SetPersonIdNil sets the value for PersonId to be an explicit nil

### UnsetPersonId
`func (o *Event) UnsetPersonId()`

UnsetPersonId ensures that no value is present for PersonId, not even an explicit nil
### GetDirection

`func (o *Event) GetDirection() string`

GetDirection returns the Direction field if non-nil, zero value otherwise.

### GetDirectionOk

`func (o *Event) GetDirectionOk() (*string, bool)`

GetDirectionOk returns a tuple with the Direction field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDirection

`func (o *Event) SetDirection(v string)`

SetDirection sets Direction field to given value.


### GetTextContent

`func (o *Event) GetTextContent() string`

GetTextContent returns the TextContent field if non-nil, zero value otherwise.

### GetTextContentOk

`func (o *Event) GetTextContentOk() (*string, bool)`

GetTextContentOk returns a tuple with the TextContent field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTextContent

`func (o *Event) SetTextContent(v string)`

SetTextContent sets TextContent field to given value.


### SetTextContentNil

`func (o *Event) SetTextContentNil(b bool)`

 SetTextContentNil sets the value for TextContent to be an explicit nil

### UnsetTextContent
`func (o *Event) UnsetTextContent()`

UnsetTextContent ensures that no value is present for TextContent, not even an explicit nil
### GetTranscription

`func (o *Event) GetTranscription() string`

GetTranscription returns the Transcription field if non-nil, zero value otherwise.

### GetTranscriptionOk

`func (o *Event) GetTranscriptionOk() (*string, bool)`

GetTranscriptionOk returns a tuple with the Transcription field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTranscription

`func (o *Event) SetTranscription(v string)`

SetTranscription sets Transcription field to given value.


### SetTranscriptionNil

`func (o *Event) SetTranscriptionNil(b bool)`

 SetTranscriptionNil sets the value for Transcription to be an explicit nil

### UnsetTranscription
`func (o *Event) UnsetTranscription()`

UnsetTranscription ensures that no value is present for Transcription, not even an explicit nil
### GetImageDescription

`func (o *Event) GetImageDescription() string`

GetImageDescription returns the ImageDescription field if non-nil, zero value otherwise.

### GetImageDescriptionOk

`func (o *Event) GetImageDescriptionOk() (*string, bool)`

GetImageDescriptionOk returns a tuple with the ImageDescription field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetImageDescription

`func (o *Event) SetImageDescription(v string)`

SetImageDescription sets ImageDescription field to given value.


### SetImageDescriptionNil

`func (o *Event) SetImageDescriptionNil(b bool)`

 SetImageDescriptionNil sets the value for ImageDescription to be an explicit nil

### UnsetImageDescription
`func (o *Event) UnsetImageDescription()`

UnsetImageDescription ensures that no value is present for ImageDescription, not even an explicit nil
### GetReceivedAt

`func (o *Event) GetReceivedAt() time.Time`

GetReceivedAt returns the ReceivedAt field if non-nil, zero value otherwise.

### GetReceivedAtOk

`func (o *Event) GetReceivedAtOk() (*time.Time, bool)`

GetReceivedAtOk returns a tuple with the ReceivedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReceivedAt

`func (o *Event) SetReceivedAt(v time.Time)`

SetReceivedAt sets ReceivedAt field to given value.


### GetProcessedAt

`func (o *Event) GetProcessedAt() time.Time`

GetProcessedAt returns the ProcessedAt field if non-nil, zero value otherwise.

### GetProcessedAtOk

`func (o *Event) GetProcessedAtOk() (*time.Time, bool)`

GetProcessedAtOk returns a tuple with the ProcessedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProcessedAt

`func (o *Event) SetProcessedAt(v time.Time)`

SetProcessedAt sets ProcessedAt field to given value.


### SetProcessedAtNil

`func (o *Event) SetProcessedAtNil(b bool)`

 SetProcessedAtNil sets the value for ProcessedAt to be an explicit nil

### UnsetProcessedAt
`func (o *Event) UnsetProcessedAt()`

UnsetProcessedAt ensures that no value is present for ProcessedAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


