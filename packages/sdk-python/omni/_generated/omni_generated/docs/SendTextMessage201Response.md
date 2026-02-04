# SendTextMessage201Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**SendTextMessage201ResponseData**](SendTextMessage201ResponseData.md) |  | 

## Example

```python
from omni_generated.models.send_text_message201_response import SendTextMessage201Response

# TODO update the JSON string below
json = "{}"
# create an instance of SendTextMessage201Response from a JSON string
send_text_message201_response_instance = SendTextMessage201Response.from_json(json)
# print the JSON string representation of the object
print(SendTextMessage201Response.to_json())

# convert the object into a dict
send_text_message201_response_dict = send_text_message201_response_instance.to_dict()
# create an instance of SendTextMessage201Response from a dict
send_text_message201_response_from_dict = SendTextMessage201Response.from_dict(send_text_message201_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


